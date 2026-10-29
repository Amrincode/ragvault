"""Explicit, offline logical backup. No automatic backup, restore, deletion or service stop."""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path

TABLES = (
    "collections",
    "documents",
    "document_chunks",
    "chunk_embeddings",
    "conversations",
    "messages",
)
KEY = re.compile(r"[0-9a-f]{32}\.pdf")


class BackupError(Exception):
    """Static diagnostics only; subprocess errors can contain private data."""


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def private_file(path: Path):
    return open(path, "xb", opener=lambda name, flags: os.open(name, flags, 0o600))


def plain_directory(path: Path) -> Path:
    path = path.expanduser().absolute()
    if not path.is_dir() or path.is_symlink() or path.is_junction() or path.resolve() != path:
        raise BackupError("Use an existing directory without links or redirected parents.")
    return path


def inventory(root: Path) -> dict[str, str]:
    """Reject orphan/working files rather than quietly excluding possibly needed evidence."""
    found = {}
    for path in root.iterdir():
        if path.is_symlink() or path.is_junction():
            raise BackupError("Storage contains a link; manual reconciliation required.")
        if path.name in {".tmp", ".trash"} and path.is_dir() and not any(path.iterdir()):
            continue
        if not KEY.fullmatch(path.name) or not path.is_file():
            raise BackupError("Storage contains unexpected or pending files; reconcile offline.")
        found[path.name] = digest(path)
    return found


def database(container: str, sql: str) -> str:
    result = subprocess.run(
        [
            "docker",
            "exec",
            container,
            "sh",
            "-c",
            "exec psql -h /var/run/postgresql -XqAt -v ON_ERROR_STOP=1 "
            '-U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"',
            "sh",
            sql,
        ],
        capture_output=True,
        check=True,
        timeout=60,
    )
    return result.stdout.decode().strip()


def snapshot(container: str) -> dict:
    # Digests remain local. Do not emit rows, document names or conversation contents.
    tables = {}
    for table in TABLES:
        value = database(
            container,
            f"SELECT count(*), md5(coalesce(string_agg(h, '' ORDER BY h), '')) "
            f"FROM (SELECT md5(row_to_json(t)::text) h FROM public.{table} t) q",
        )
        tables[table] = value
    documents = json.loads(
        database(
            container,
            "SELECT coalesce(json_agg(q ORDER BY storage_key), '[]') FROM "
            "(SELECT storage_key, checksum, file_size FROM documents) q",
        )
    )
    return {
        "tables": tables,
        "documents": documents,
        "revision": database(container, "SELECT version_num FROM alembic_version"),
        "postgres_major": int(database(container, "SHOW server_version_num")) // 10000,
        "vector_version": database(
            container, "SELECT extversion FROM pg_extension WHERE extname='vector'"
        ),
    }


def create(container: str, uploads: Path, output: Path, *, writers_stopped: bool) -> None:
    if not writers_stopped:
        raise BackupError(
            "Stop all API instances, workers and external writers; confirm explicitly."
        )
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", container):
        raise BackupError("Invalid container name or ID.")
    uploads = plain_directory(uploads)
    parent = plain_directory(output.expanduser().absolute().parent)
    output = parent / output.name
    if not output.name.endswith(".ragvault-backup"):
        raise BackupError(
            "Use a new .ragvault-backup directory so Git excludes all backup contents."
        )
    if output.exists() or output.is_symlink() or output.is_junction():
        raise BackupError("Backup output must be new; existing output is never overwritten.")
    if output.is_relative_to(uploads) or uploads.is_relative_to(output):
        raise BackupError("Backup output must be separate from upload storage.")
    before = snapshot(container)
    if before["postgres_major"] != 17 or before["revision"] != "0004_conversations":
        raise BackupError("Unsupported database major or schema; review the recovery runbook.")
    expected = {row["storage_key"]: row["checksum"] for row in before["documents"]}
    if any(not KEY.fullmatch(key) for key in expected) or inventory(uploads) != expected:
        raise BackupError("Database and original PDF inventory disagree; reconcile offline.")
    if any(
        (uploads / row["storage_key"]).stat().st_size != row["file_size"]
        for row in before["documents"]
    ):
        raise BackupError("Original PDF sizes disagree with database metadata.")
    output.mkdir(mode=0o700)
    # Failure leaves an incomplete sensitive directory, never a valid manifest.
    originals = output / "uploads"
    originals.mkdir(mode=0o700)
    for key in expected:
        with (uploads / key).open("rb") as source, private_file(originals / key) as destination:
            shutil.copyfileobj(source, destination)
    dump = output / "database.dump"
    with private_file(dump) as destination:
        subprocess.run(
            [
                "docker",
                "exec",
                container,
                "sh",
                "-c",
                'exec pg_dump -h /var/run/postgresql -U "$POSTGRES_USER" -d "$POSTGRES_DB" '
                "--format=custom --no-owner --no-privileges",
            ],
            stdout=destination,
            stderr=subprocess.PIPE,
            check=True,
            timeout=600,
        )
    if snapshot(container) != before or inventory(uploads) != expected:
        raise BackupError(
            "Source changed during backup; keep writers stopped and retry new output."
        )
    if inventory(originals) != expected:
        raise BackupError("Backup PDF checksum mismatch; backup is incomplete.")
    manifest = {
        "format": 1,
        "created_utc": datetime.now(UTC).isoformat(),
        "database_sha256": digest(dump),
        "uploads": expected,
        "snapshot": before,
    }
    with private_file(output / "manifest.json") as destination:
        destination.write(json.dumps(manifest, indent=2).encode())
    verify(output)


def verify(output: Path) -> dict:
    output = plain_directory(output)
    if {p.name for p in output.iterdir()} != {"manifest.json", "database.dump", "uploads"}:
        raise BackupError("Backup is incomplete or contains unexpected files.")
    for name in ("manifest.json", "database.dump"):
        path = output / name
        if path.is_symlink() or path.is_junction() or not path.is_file():
            raise BackupError("Backup files must be regular files without links.")
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("snapshot"), dict):
        raise BackupError("Invalid backup manifest.")
    if manifest.get("format") != 1 or manifest["snapshot"]["postgres_major"] != 17:
        raise BackupError("Unsupported backup format or PostgreSQL major.")
    if digest(output / "database.dump") != manifest["database_sha256"]:
        raise BackupError("Database dump checksum mismatch.")
    if inventory(plain_directory(output / "uploads")) != manifest["uploads"]:
        raise BackupError("Backup PDF checksum mismatch.")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    backup = commands.add_parser(
        "create", help="Sensitive local output; all writers must be stopped"
    )
    backup.add_argument("--container", required=True)
    backup.add_argument("--uploads", type=Path, required=True)
    backup.add_argument("--output", type=Path, required=True)
    backup.add_argument("--writers-stopped", action="store_true")
    check = commands.add_parser("verify", help="Checksums only; does not restore or connect to DB")
    check.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "create":
            create(args.container, args.uploads, args.output, writers_stopped=args.writers_stopped)
        else:
            verify(args.output)
    except (BackupError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print(
            "Backup check failed. Keep writers stopped; consult the offline recovery runbook. "
            "Incomplete output may contain sensitive data. Raw diagnostics withheld."
        )
        return 1
    print("Local backup checks passed. Output is sensitive; a restore drill is still required.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

import hashlib
import os
import subprocess

import pytest

from app import backup

KEY = "a" * 32 + ".pdf"


@pytest.fixture
def source(tmp_path, monkeypatch):
    uploads = tmp_path / "originals"
    uploads.mkdir()
    (uploads / KEY).write_bytes(b"%PDF-synthetic")
    snapshot = {
        "tables": {"documents": "1|digest"},
        "revision": "0004_conversations",
        "postgres_major": 17,
        "vector_version": "0.8.7",
        "documents": [
            {
                "storage_key": KEY,
                "checksum": backup.digest(uploads / KEY),
                "file_size": (uploads / KEY).stat().st_size,
            }
        ],
    }
    monkeypatch.setattr(backup, "snapshot", lambda _: snapshot)

    def dump(*args, **kwargs):
        kwargs["stdout"].write(b"synthetic-dump")

    monkeypatch.setattr(backup.subprocess, "run", dump)
    return uploads, tmp_path / "test.ragvault-backup", snapshot


def test_backup_preserves_source_and_detects_corruption(source):
    uploads, output, _ = source
    original = (uploads / KEY).read_bytes()
    backup.create("synthetic-db", uploads, output, writers_stopped=True)
    manifest = backup.verify(output)
    assert manifest["database_sha256"] == hashlib.sha256(b"synthetic-dump").hexdigest()
    assert (uploads / KEY).read_bytes() == original
    assert (output / "uploads" / KEY).read_bytes() == original
    if os.name != "nt":
        assert output.stat().st_mode & 0o777 == 0o700
        assert (output / "database.dump").stat().st_mode & 0o777 == 0o600
    (output / "database.dump").write_bytes(b"corrupt")
    with pytest.raises(backup.BackupError, match="checksum"):
        backup.verify(output)


@pytest.mark.parametrize(
    "problem",
    ["missing", "orphan", "checksum", "pending", "size", "revision", "major", "unsafe_key"],
)
def test_inconsistent_backup_refused_before_output(source, problem):
    uploads, output, snapshot = source
    if problem == "missing":
        (uploads / KEY).unlink()
    elif problem == "orphan":
        (uploads / ("b" * 32 + ".pdf")).write_bytes(b"%PDF-orphan")
    elif problem == "checksum":
        (uploads / KEY).write_bytes(b"changed")
    elif problem == "pending":
        (uploads / ".trash").mkdir()
        (uploads / ".trash" / KEY).write_bytes(b"pending")
    elif problem == "size":
        snapshot["documents"][0]["file_size"] += 1
    elif problem == "revision":
        snapshot["revision"] = "future"
    elif problem == "major":
        snapshot["postgres_major"] = 18
    else:
        snapshot["documents"][0]["storage_key"] = "../private.pdf"
    with pytest.raises(backup.BackupError):
        backup.create("synthetic-db", uploads, output, writers_stopped=True)
    assert not output.exists()


def test_requires_explicit_offline_confirmation_and_new_destination(source):
    uploads, output, _ = source
    with pytest.raises(backup.BackupError):
        backup.create("synthetic-db", uploads, output, writers_stopped=False)
    with pytest.raises(backup.BackupError):
        backup.create(
            "synthetic-db", uploads, uploads / "nested.ragvault-backup", writers_stopped=True
        )
    output.mkdir()
    with pytest.raises(backup.BackupError):
        backup.create("synthetic-db", uploads, output, writers_stopped=True)
    assert list(output.iterdir()) == []


def test_failed_dump_never_gets_complete_manifest(source, monkeypatch):
    uploads, output, _ = source

    def fail(*args, **kwargs):
        raise subprocess.CalledProcessError(1, [], stderr=b"private-password")

    monkeypatch.setattr(backup.subprocess, "run", fail)
    with pytest.raises(subprocess.CalledProcessError):
        backup.create("synthetic-db", uploads, output, writers_stopped=True)
    assert not (output / "manifest.json").exists()
    with pytest.raises(backup.BackupError):
        backup.verify(output)


def test_source_change_during_dump_invalidates_backup(source, monkeypatch):
    uploads, output, _ = source
    original = backup.subprocess.run

    def change(*args, **kwargs):
        original(*args, **kwargs)
        (uploads / KEY).write_bytes(b"changed")

    monkeypatch.setattr(backup.subprocess, "run", change)
    with pytest.raises(backup.BackupError, match="changed"):
        backup.create("synthetic-db", uploads, output, writers_stopped=True)
    assert not (output / "manifest.json").exists()


def test_backup_pdf_tampering_and_unexpected_files_rejected(source):
    uploads, output, _ = source
    backup.create("synthetic-db", uploads, output, writers_stopped=True)
    (output / "extra").write_bytes(b"unexpected")
    with pytest.raises(backup.BackupError, match="unexpected"):
        backup.verify(output)
    (output / "extra").unlink()
    (output / "uploads" / KEY).write_bytes(b"corrupt")
    with pytest.raises(backup.BackupError):
        backup.verify(output)


def test_database_change_during_backup_invalidates_pair(source, monkeypatch):
    uploads, output, snapshot = source
    changed = {**snapshot, "tables": {"documents": "2|changed"}}
    snapshots = iter([snapshot, changed])
    monkeypatch.setattr(backup, "snapshot", lambda _: next(snapshots))
    with pytest.raises(backup.BackupError, match="changed"):
        backup.create("synthetic-db", uploads, output, writers_stopped=True)
    assert not (output / "manifest.json").exists()


def test_malformed_manifest_is_a_safe_failure(source):
    uploads, output, _ = source
    backup.create("synthetic-db", uploads, output, writers_stopped=True)
    (output / "manifest.json").write_text("[]")
    with pytest.raises(backup.BackupError):
        backup.verify(output)


@pytest.mark.skipif(os.name == "nt", reason="Native symlink creation needs special privileges")
def test_backup_refuses_links(source):
    uploads, output, _ = source
    (uploads / "linked").symlink_to(uploads / KEY)
    with pytest.raises(backup.BackupError):
        backup.create("synthetic-db", uploads, output, writers_stopped=True)
    assert not output.exists()


def test_cli_never_prints_private_subprocess_details(source, monkeypatch, capsys):
    uploads, output, _ = source
    monkeypatch.setattr(
        "sys.argv",
        [
            "backup",
            "create",
            "--container",
            "synthetic",
            "--uploads",
            str(uploads),
            "--output",
            str(output),
            "--writers-stopped",
        ],
    )
    monkeypatch.setattr(
        backup,
        "create",
        lambda *a, **kw: (_ for _ in ()).throw(
            subprocess.CalledProcessError(1, "private-path", stderr="private-password")
        ),
    )
    assert backup.main() == 1
    assert "private-" not in capsys.readouterr().out

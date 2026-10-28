from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize("password_override", [None, "environment-password"])
def test_environment_overrides_dotenv(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, password_override: str | None
) -> None:
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "POSTGRES_PASSWORD=file-password\nBACKEND_PORT=8001\n"
        "OLLAMA_BASE_URL=http://host.docker.internal:11434\nVITE_API_BASE_URL=http://localhost:8001\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("BACKEND_PORT", "9000")
    if password_override is not None:
        monkeypatch.setenv("POSTGRES_PASSWORD", password_override)
    config = Settings(_env_file=env_file)
    assert config.backend_port == 9000
    assert config.postgres_password.get_secret_value() == (password_override or "file-password")
    assert config.ollama_base_url.host == "host.docker.internal"


def test_database_url_handles_special_password_characters() -> None:
    password = "p@ss:word%/with?#characters"
    config = Settings(_env_file=None, postgres_password=password)
    assert config.database_url.password == password
    assert config.database_url.drivername == "postgresql+psycopg"
    assert password not in repr(config)
    assert password not in str(config.database_url)


@pytest.mark.parametrize(
    "value",
    [
        "*",
        "http://localhost:5173/dashboard",
        "http://user:secret@localhost:5173",
        "http://:secret@localhost:5173",
        "ftp://example.com",
    ],
)
def test_invalid_cors_origin_is_rejected(value: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, postgres_password="test", frontend_origin=value)


@pytest.mark.parametrize("value", [0, 65536])
def test_invalid_backend_port_is_rejected(value: int) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, postgres_password="test", backend_port=value)


@pytest.mark.parametrize("field", ["database_timeout_seconds", "ollama_timeout_seconds"])
def test_nonpositive_timeouts_are_rejected(field: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, postgres_password="test", **{field: 0})


def test_cors_origin_has_no_trailing_slash() -> None:
    config = Settings(
        _env_file=None, postgres_password="test", frontend_origin="https://example.com/"
    )
    assert config.cors_origin == "https://example.com"


def test_password_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_upload_directory_is_relative_to_repository() -> None:
    from app.core.config import ROOT_ENV_FILE

    config = Settings(_env_file=None, postgres_password="test", upload_dir="data/custom")
    assert config.upload_dir == ROOT_ENV_FILE.parent / "data/custom"


@pytest.mark.parametrize("field", ["max_upload_bytes", "max_pdf_pages"])
def test_upload_limits_must_be_positive(field: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, postgres_password="test", **{field: 0})


@pytest.mark.parametrize(
    "field",
    [
        "postgres_host",
        "postgres_db",
        "postgres_user",
        "backend_host",
        "postgres_password",
        "ollama_chat_model",
        "ollama_embedding_model",
    ],
)
def test_blank_connection_and_model_settings_rejected(field):
    values = {"postgres_password": "test", field: "   "}
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


@pytest.mark.parametrize(
    "host", ["http://localhost", "local host", "localhost/private", "localhost:8000"]
)
def test_malformed_bind_host_rejected(host):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, postgres_password="test", backend_host=host)


def test_password_whitespace_is_preserved_when_nonblank():
    assert (
        Settings(_env_file=None, postgres_password=" pass ").postgres_password.get_secret_value()
        == " pass "
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://user:private@localhost:11434",
        "http://localhost:11434?token=private",
        "http://localhost:11434#private",
    ],
)
def test_ollama_url_rejects_hidden_credentials_without_echoing_input(url):
    with pytest.raises(ValidationError) as failure:
        Settings(_env_file=None, postgres_password="test", ollama_base_url=url)
    assert "private" not in str(failure.value)


def test_combined_validation_error_does_not_echo_secret_input():
    with pytest.raises(ValidationError) as failure:
        Settings(_env_file=None, postgres_password="private-value", chunk_overlap_chars=1500)
    assert "private-value" not in str(failure.value)


def test_cli_configuration_failure_is_redacted(monkeypatch, capsys):
    from app.__main__ import main
    from app.core.config import get_settings

    monkeypatch.setattr("sys.argv", ["app"])
    monkeypatch.setenv("BACKEND_PORT", "private-input")
    get_settings.cache_clear()
    try:
        with pytest.raises(SystemExit) as code:
            main()
        assert code.value.code == 2
        output = capsys.readouterr().err
        assert "BACKEND_PORT" in output and "private-input" not in output
    finally:
        get_settings.cache_clear()

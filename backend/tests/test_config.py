from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_environment_overrides_dotenv(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "POSTGRES_PASSWORD=file-password\nBACKEND_PORT=8001\n"
        "OLLAMA_BASE_URL=http://host.docker.internal:11434\nVITE_API_BASE_URL=http://localhost:8001\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("BACKEND_PORT", "9000")
    config = Settings(_env_file=env_file)
    assert config.backend_port == 9000
    assert config.postgres_password.get_secret_value() == "file-password"
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

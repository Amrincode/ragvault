import re
from functools import lru_cache
from ipaddress import ip_address
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict, SettingsError
from sqlalchemy import URL

ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_ENV_FILE, env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True
    )

    app_env: Literal["development", "test", "production"] = "development"
    backend_host: str = "127.0.0.1"
    backend_port: int = Field(default=8000, ge=1, le=65535)
    frontend_origin: AnyHttpUrl = AnyHttpUrl("http://localhost:5173")
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    postgres_host: str = "localhost"
    postgres_port: int = Field(default=5432, ge=1, le=65535)
    postgres_db: str = "ragvault"
    postgres_user: str = "ragvault"
    postgres_password: SecretStr = Field(min_length=1)
    database_timeout_seconds: int = Field(default=3, ge=2, le=30)

    ollama_base_url: AnyHttpUrl = AnyHttpUrl("http://localhost:11434")
    ollama_chat_model: str = Field(default="gemma3:4b", min_length=1, max_length=200)
    ollama_embedding_model: str = "nomic-embed-text"
    ollama_timeout_seconds: float = Field(default=3.0, gt=0, le=30)

    upload_dir: Path = ROOT_ENV_FILE.parent / "data" / "uploads"
    max_upload_bytes: int = Field(default=25 * 1024 * 1024, ge=1024, le=1024 * 1024 * 1024)
    max_pdf_pages: int = Field(default=2000, ge=1, le=10000)
    pdf_validation_timeout_seconds: int = Field(default=15, ge=1, le=60)
    chunk_size_chars: int = Field(default=1200, ge=128, le=8000)
    chunk_overlap_chars: int = Field(default=200, ge=0, le=2000)
    processing_timeout_seconds: int = Field(default=60, ge=5, le=180)
    max_page_text_chars: int = Field(default=100_000, ge=1000, le=500_000)
    max_extracted_chars: int = Field(default=1_000_000, ge=1000, le=5_000_000)
    max_document_chunks: int = Field(default=5000, ge=1, le=10_000)
    embedding_timeout_seconds: int = Field(default=60, ge=2, le=180)
    indexing_timeout_seconds: int = Field(default=180, ge=10, le=600)
    embedding_batch_size: int = Field(default=16, ge=1, le=32)
    max_index_chunks: int = Field(default=2000, ge=1, le=5000)
    max_index_vector_values: int = Field(default=2_000_000, ge=1, le=10_000_000)
    max_embedding_dimensions: int = Field(default=4096, ge=1, le=16000)
    embedding_document_prefix: str = Field(default="search_document: ", max_length=128)
    embedding_query_prefix: str = Field(default="search_query: ", max_length=128)
    search_top_k: int = Field(default=5, ge=1, le=20)

    chat_connect_timeout_seconds: float = Field(default=3, gt=0, le=30)
    chat_generation_timeout_seconds: float = Field(default=180, ge=5, le=300)
    chat_context_tokens: int = Field(default=4096, ge=2048, le=8192)
    chat_response_tokens: int = Field(default=512, ge=64, le=1024)
    chat_max_answer_chars: int = Field(default=4000, ge=256, le=12000)
    rag_top_k: int = Field(default=5, ge=1, le=20)
    rag_context_chars: int = Field(default=6000, ge=512, le=12000)
    rag_passage_chars: int = Field(default=1600, ge=128, le=4000)
    rag_min_similarity: float = Field(default=0.5, ge=-1, le=1)
    conversation_history_messages: int = Field(default=4, ge=0, le=20)
    conversation_history_chars: int = Field(default=600, ge=0, le=2000)
    conversation_max_messages: int = Field(default=500, ge=2, le=10000)

    @field_validator("postgres_password")
    @classmethod
    def validate_password(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("POSTGRES_PASSWORD must not be blank")
        return value

    @field_validator("backend_host", "postgres_host", "postgres_db", "postgres_user")
    @classmethod
    def validate_connection_fields(cls, value: str) -> str:
        if not value.strip() or "\x00" in value:
            raise ValueError("Connection settings must not be blank or contain NUL")
        return value

    @field_validator("backend_host")
    @classmethod
    def validate_bind_host(cls, value: str) -> str:
        try:
            ip_address(value)
        except ValueError:
            if not re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?", value):
                raise ValueError("BACKEND_HOST must be an IP address or hostname") from None
        return value

    @field_validator("ollama_chat_model", "ollama_embedding_model")
    @classmethod
    def validate_model_names(cls, value: str) -> str:
        if not value or len(value) > 200 or any(c.isspace() or ord(c) < 32 for c in value):
            raise ValueError(
                "Model names must not be empty or contain whitespace/control characters"
            )
        return value

    @field_validator("ollama_base_url")
    @classmethod
    def validate_ollama_url(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if value.username or value.password or value.query or value.fragment:
            raise ValueError("OLLAMA_BASE_URL must not contain credentials, query or fragment")
        return value

    @model_validator(mode="after")
    def validate_chunking(self) -> "Settings":
        if self.chunk_overlap_chars >= self.chunk_size_chars:
            raise ValueError("Chunk overlap must be smaller than chunk size")
        return self

    @field_validator("upload_dir")
    @classmethod
    def resolve_upload_dir(cls, value: Path) -> Path:
        return value if value.is_absolute() else ROOT_ENV_FILE.parent / value

    @field_validator("frontend_origin")
    @classmethod
    def validate_origin(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if (
            value.path not in (None, "/")
            or value.query
            or value.fragment
            or value.username
            or value.password
        ):
            raise ValueError(
                "FRONTEND_ORIGIN must be an HTTP(S) origin without a path or credentials"
            )
        return value

    @property
    def cors_origin(self) -> str:
        return str(self.frontend_origin).rstrip("/")

    @property
    def database_url(self) -> URL:
        # URL.create safely handles passwords containing @, %, : and other URL characters.
        return URL.create(
            "postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_password.get_secret_value(),
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )


@lru_cache
def get_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        fields = sorted(
            {str(e["loc"][0]).upper() if e["loc"] else "SETTINGS" for e in exc.errors()}
        )
        raise ConfigurationError(
            "Missing or invalid configuration: "
            + ", ".join(fields)
            + ". Check process environment overrides and the root .env against .env.example."
        ) from None
    except (SettingsError, OSError, UnicodeError):
        raise ConfigurationError(
            "Configuration could not be read. Check root .env encoding, syntax and permissions."
        ) from None


class ConfigurationError(ValueError):
    """Safe public diagnostic without input values or raw validation exceptions."""

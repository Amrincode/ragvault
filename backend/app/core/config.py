from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_ENV_FILE, env_file_encoding="utf-8", extra="ignore"
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
    ollama_chat_model: str = "llama3.2"
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
    return Settings()

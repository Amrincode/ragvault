"""Import models so Alembic sees the complete application metadata."""

from app.models.library import Collection, Document

__all__ = ["Collection", "Document"]

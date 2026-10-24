import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.health import router as health_router
from app.api.library import router as library_router
from app.api.search import router as search_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.core.origin import LibraryOriginMiddleware
from app.core.upload_limit import UploadLimitMiddleware
from app.db.session import build_engine
from app.services.embeddings import EmbeddingClient
from app.services.indexing import DocumentIndexer
from app.services.ollama import OllamaClient
from app.services.processing import PdfProcessor
from app.services.search import SemanticSearch
from app.services.storage import DocumentStorage

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else get_settings()
    configure_logging(config.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = build_engine(config)
        app.state.engine = engine
        app.state.settings = config
        app.state.storage = DocumentStorage(config)
        app.state.processor = PdfProcessor(config)
        app.state.indexer = DocumentIndexer(config)
        app.state.semantic_search = SemanticSearch(config)
        try:
            with httpx.Client(
                base_url=str(config.ollama_base_url).rstrip("/") + "/",
                timeout=httpx.Timeout(config.ollama_timeout_seconds),
                trust_env=False,
            ) as client:
                app.state.ollama = OllamaClient(client)
                with httpx.Client(
                    base_url=str(config.ollama_base_url).rstrip("/") + "/",
                    timeout=config.embedding_timeout_seconds,
                    trust_env=False,
                ) as embedding_http:
                    app.state.embeddings = EmbeddingClient(embedding_http, config)
                    logger.info("RAGVault started")
                    yield
        finally:
            engine.dispose()
            logger.info("RAGVault stopped")

    app = FastAPI(title="RAGVault API", version="0.4.0", lifespan=lifespan)
    app.add_middleware(UploadLimitMiddleware, max_bytes=config.max_upload_bytes)
    app.add_middleware(
        LibraryOriginMiddleware,
        allowed_origins=[
            config.cors_origin,
            f"http://localhost:{config.backend_port}",
            f"http://127.0.0.1:{config.backend_port}",
        ],
    )
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=[
            "localhost",
            "127.0.0.1",
            "[::1]",
            *(["testserver"] if config.app_env == "test" else []),
        ],
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.cors_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Accept", "Content-Type"],
    )
    app.include_router(health_router)
    app.include_router(library_router)
    app.include_router(search_router)

    @app.exception_handler(SQLAlchemyError)
    async def database_failure(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        logger.error("Database operation failed", extra={"error_type": type(exc).__name__})
        return JSONResponse(
            status_code=503,
            content={
                "detail": {
                    "code": "database_unavailable",
                    "message": "Database operation failed; please retry",
                }
            },
        )

    @app.exception_handler(OSError)
    async def storage_failure(request: Request, exc: OSError) -> JSONResponse:
        logger.error("Storage operation failed", extra={"error_type": type(exc).__name__})
        return JSONResponse(
            status_code=503,
            content={
                "detail": {
                    "code": "storage_unavailable",
                    "message": "File storage is unavailable; please retry",
                }
            },
        )

    @app.get("/", tags=["application"])
    def root() -> dict[str, str]:
        return {"name": "RAGVault API", "status": "ok", "environment": config.app_env}

    return app

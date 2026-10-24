import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.db.session import build_engine
from app.services.ollama import OllamaClient

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else get_settings()
    configure_logging(config.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = build_engine(config)
        app.state.engine = engine
        try:
            with httpx.Client(
                base_url=str(config.ollama_base_url).rstrip("/") + "/",
                timeout=httpx.Timeout(config.ollama_timeout_seconds),
                trust_env=False,
            ) as client:
                app.state.ollama = OllamaClient(client)
                logger.info("RAGVault started")
                yield
        finally:
            engine.dispose()
            logger.info("RAGVault stopped")

    app = FastAPI(title="RAGVault API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[config.cors_origin],
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "Content-Type"],
    )
    app.include_router(health_router)

    @app.get("/", tags=["application"])
    def root() -> dict[str, str]:
        return {"name": "RAGVault API", "status": "ok", "environment": config.app_env}

    return app

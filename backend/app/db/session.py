import logging
from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.schemas.health import DependencyHealth

logger = logging.getLogger(__name__)


def build_engine(settings: Settings) -> Engine:
    timeout = settings.database_timeout_seconds
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_timeout=timeout,
        connect_args={
            "connect_timeout": timeout,
            "options": f"-c statement_timeout={timeout * 1000}",
        },
    )


def get_engine(request: Request) -> Engine:
    return request.app.state.engine


def get_session(request: Request) -> Iterator[Session]:
    with Session(get_engine(request)) as session:
        yield session


def check_database(engine: Engine) -> DependencyHealth:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return DependencyHealth(status="connected")
    except SQLAlchemyError as exc:
        # Raw DB exceptions can include connection strings; keep secrets out of logs/responses.
        logger.warning(
            "Dependency check failed",
            extra={"dependency": "database", "error_type": type(exc).__name__},
        )
        return DependencyHealth(status="unavailable", detail="PostgreSQL connection check failed")

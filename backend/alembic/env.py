from sqlalchemy import create_engine, pool

from alembic import context
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.base import Base

settings = get_settings()
configure_logging(settings.log_level)
target_metadata = Base.metadata
# Import future model modules here so autogenerate can see their tables.


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Migrations are a short-lived CLI operation and do not need pooled connections.
    engine = create_engine(
        settings.database_url,
        poolclass=pool.NullPool,
        connect_args={"connect_timeout": settings.database_timeout_seconds},
    )
    try:
        with engine.connect() as connection:
            context.configure(
                connection=connection, target_metadata=target_metadata, compare_type=True
            )
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

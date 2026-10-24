from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from app.core.config import Settings
from app.db.session import get_engine
from app.main import create_app
from app.schemas.health import DependencyHealth
from app.services.ollama import OllamaClient, get_ollama


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, app_env="test", postgres_password="test-only-password")


@pytest.fixture
def engine() -> MagicMock:
    return MagicMock(spec=Engine)


@pytest.fixture
def ollama() -> MagicMock:
    client = MagicMock(spec=OllamaClient)
    client.check_health.return_value = DependencyHealth(status="connected")
    return client


@pytest.fixture
def client(settings: Settings, engine: MagicMock, ollama: MagicMock) -> Iterator[TestClient]:
    app = create_app(settings)
    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[get_ollama] = lambda: ollama
    with TestClient(app) as test_client:
        yield test_client

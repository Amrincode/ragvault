from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError, TimeoutError

from app.schemas.health import DependencyHealth


def test_root_is_application_liveness(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"name": "RAGVault API", "status": "ok", "environment": "test"}


def test_health_all_dependencies_connected(client: TestClient, engine: MagicMock) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "status": "ok",
        "application": "ok",
        "database": {"status": "connected"},
        "ollama": {"status": "connected"},
    }
    statement = engine.connect.return_value.__enter__.return_value.execute.call_args.args[0]
    assert str(statement) == "SELECT 1"


@pytest.mark.parametrize(
    "failure",
    [
        OperationalError("connect", {}, Exception("private-password")),
        TimeoutError("pool timed out"),
    ],
)
def test_database_failure_does_not_hide_ollama(
    client: TestClient, engine: MagicMock, ollama: MagicMock, failure: Exception
) -> None:
    engine.connect.side_effect = failure
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["database"] == {
        "status": "unavailable",
        "detail": "PostgreSQL connection check failed",
    }
    assert response.json()["ollama"]["status"] == "connected"
    assert "private-password" not in response.text
    ollama.check_health.assert_called_once()
    assert client.get("/").status_code == 200


@pytest.mark.parametrize("database_fails", [False, True])
def test_ollama_failure_is_reported_without_crashing(
    client: TestClient, engine: MagicMock, ollama: MagicMock, database_fails: bool
) -> None:
    if database_fails:
        engine.connect.side_effect = OperationalError("connect", {}, Exception("offline"))
    ollama.check_health.return_value = DependencyHealth(
        status="unavailable", detail="Ollama connectivity check failed"
    )
    response = client.get("/api/health")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["application"] == "ok"
    assert body["database"]["status"] == ("unavailable" if database_fails else "connected")
    assert body["ollama"]["status"] == "unavailable"
    assert client.get("/").status_code == 200


def test_health_recovers_on_next_check(client: TestClient, engine: MagicMock) -> None:
    engine.connect.side_effect = TimeoutError("temporary outage")
    assert client.get("/api/health").status_code == 503
    engine.connect.side_effect = None
    assert client.get("/api/health").status_code == 200


def test_cors_allows_configured_origin(client: TestClient) -> None:
    response = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_rejects_other_origins(client: TestClient) -> None:
    response = client.options(
        "/api/health",
        headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers

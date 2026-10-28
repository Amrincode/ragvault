from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from app.core.config import Settings
from app.main import create_app


def test_startup_does_not_connect_and_shutdown_releases_resources(settings: Settings) -> None:
    engine = MagicMock(spec=Engine)
    with patch("app.main.build_engine", return_value=engine):
        app = create_app(settings)
        with TestClient(app) as client:
            assert client.get("/").status_code == 200
            engine.connect.assert_not_called()
            http_client = app.state.ollama.client
            assert not http_client.is_closed
            chat_client = app.state.llm.client
            assert not chat_client.is_closed
        engine.dispose.assert_called_once()
        assert http_client.is_closed
        assert chat_client.is_closed


def test_storage_startup_failure_disposes_engine_and_redacts_details(settings: Settings) -> None:
    engine = MagicMock(spec=Engine)
    with (
        patch("app.main.build_engine", return_value=engine),
        patch("app.main.DocumentStorage", side_effect=PermissionError("private path")),
        pytest.raises(RuntimeError, match="Upload storage initialization failed") as failure,
        TestClient(create_app(settings)),
    ):
        pytest.fail("Storage failure must stop startup")
    assert "private path" not in str(failure.value)
    engine.dispose.assert_called_once()


def test_interrupted_client_initialization_disposes_engine(settings: Settings) -> None:
    engine = MagicMock(spec=Engine)
    with (
        patch("app.main.build_engine", return_value=engine),
        patch("app.main.httpx.Client", side_effect=RuntimeError("client initialization failed")),
        pytest.raises(RuntimeError, match="client initialization failed"),
        TestClient(create_app(settings)),
    ):
        pytest.fail("Initialization failure must stop startup")
    engine.dispose.assert_called_once()

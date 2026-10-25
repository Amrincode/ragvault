from unittest.mock import MagicMock, patch

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

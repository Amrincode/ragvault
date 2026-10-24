import logging

import httpx
from fastapi import Request

from app.schemas.health import DependencyHealth

logger = logging.getLogger(__name__)


class OllamaClient:
    def __init__(self, client: httpx.Client) -> None:
        self.client = client

    def check_health(self) -> DependencyHealth:
        try:
            response = self.client.get("api/tags")
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("models"), list):
                raise ValueError("Unexpected Ollama response")
            return DependencyHealth(status="connected")
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning(
                "Dependency check failed",
                extra={"dependency": "ollama", "error_type": type(exc).__name__},
            )
            return DependencyHealth(status="unavailable", detail="Ollama connectivity check failed")


def get_ollama(request: Request) -> OllamaClient:
    return request.app.state.ollama

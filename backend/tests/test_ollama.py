import httpx
import pytest

from app.services.ollama import OllamaClient


@pytest.mark.parametrize("models", [[], [{"name": "example-model"}]])
def test_ollama_checks_connectivity_without_requiring_models(models: list[dict[str, str]]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "http://ollama.test/api/tags"
        assert request.method == "GET"
        assert request.extensions["timeout"]["read"] == 3.0
        return httpx.Response(200, json={"models": models})

    with httpx.Client(
        base_url="http://ollama.test/", timeout=3.0, transport=httpx.MockTransport(handler)
    ) as client:
        assert OllamaClient(client).check_health().status == "connected"


@pytest.mark.parametrize("status_code", [404, 500])
def test_ollama_http_errors_are_unavailable(status_code: int) -> None:
    with httpx.Client(
        base_url="http://ollama.test/",
        transport=httpx.MockTransport(lambda _: httpx.Response(status_code)),
    ) as client:
        assert OllamaClient(client).check_health().status == "unavailable"


@pytest.mark.parametrize("payload", [b"not-json", b"[]", b'{"models": null}', b"{}"])
def test_ollama_invalid_response_is_unavailable(payload: bytes) -> None:
    with httpx.Client(
        base_url="http://ollama.test/",
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=payload)),
    ) as client:
        assert OllamaClient(client).check_health().status == "unavailable"


@pytest.mark.parametrize("error_type", [httpx.ConnectError, httpx.ReadTimeout])
def test_ollama_connection_errors_are_unavailable(error_type: type[httpx.RequestError]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error_type("private service detail", request=request)

    with httpx.Client(
        base_url="http://ollama.test/", transport=httpx.MockTransport(handler)
    ) as client:
        result = OllamaClient(client).check_health()
        assert result.status == "unavailable"
        assert result.detail == "Ollama connectivity check failed"

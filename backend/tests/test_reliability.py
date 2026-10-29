import asyncio
import json
import logging
from unittest.mock import MagicMock, patch

import pytest

from app import __main__
from app.core.logging import (
    JsonFormatter,
    RequestDiagnosticsMiddleware,
    operation_timing,
    request_id,
)


def test_request_id_is_generated_not_reflected_and_covers_errors(client, caplog):
    logger = logging.getLogger("app")
    logger.addHandler(caplog.handler)
    try:
        first = client.get(
            "/api/health?private=secret",
            headers={"X-Request-ID": "private-header", "Origin": "http://localhost:5173"},
        )
        assert "X-Request-ID" in first.headers["access-control-expose-headers"]
        second = client.get("/private-pdf-filename?question=secret")
        invalid = client.post("/api/search", json={"query": "private-question", "top_k": 99})
        identifiers = [r.headers["x-request-id"] for r in (first, second, invalid)]
        assert len(set(identifiers)) == 3 and all(len(value) == 32 for value in identifiers)
        records = [r for r in caplog.records if r.name == "app.requests"]
        payloads = [json.loads(JsonFormatter().format(r)) for r in records]
        assert [r["route"] for r in payloads] == ["/api/health", "unmatched", "/api/search"]
        assert [r["status_code"] for r in payloads] == [200, 404, 422]
        assert [r["request_id"] for r in payloads] == identifiers
        assert all(r["duration_ms"] >= 0 for r in payloads)
        assert "private" not in json.dumps(payloads) and "secret" not in json.dumps(payloads)
        assert request_id.get() is None
    finally:
        logger.removeHandler(caplog.handler)


def test_concurrent_context_isolation_and_disconnect_cleanup():
    seen = []

    async def downstream(scope, receive, send):
        identifier = request_id.get()
        await asyncio.sleep(0.01)
        assert request_id.get() == identifier
        seen.append(identifier)
        if scope.get("disconnect"):
            raise asyncio.CancelledError
        await send({"type": "http.response.start", "status": 200, "headers": []})

    async def run():
        middleware = RequestDiagnosticsMiddleware(downstream)

        async def send(message):
            assert message["headers"][0][0] == b"x-request-id"

        async def one(disconnect=False):
            try:
                await middleware(
                    {"type": "http", "method": "GET", "disconnect": disconnect}, MagicMock(), send
                )
            except asyncio.CancelledError:
                pass
            assert request_id.get() is None

        await asyncio.gather(one(), one(), one(True))

    asyncio.run(run())
    assert len(set(seen)) == 3


def test_timing_is_numeric_and_formatter_drops_sensitive_extras():
    with patch("app.core.logging.logging.getLogger") as get_logger:
        operation_timing("processing", 0, completed=False)
    extra = get_logger.return_value.info.call_args.kwargs["extra"]
    assert extra["operation"] == "processing" and extra["outcome"] == "failed"
    assert extra["duration_ms"] >= 0
    record = logging.makeLogRecord(
        {
            "msg": "Safe message",
            "private": "secret",
            "exc_info": (ValueError, ValueError("secret"), None),
            **extra,
        }
    )
    assert "secret" not in JsonFormatter().format(record)


def test_native_entrypoint_disables_raw_access_urls(monkeypatch):
    monkeypatch.setattr("sys.argv", ["app"])
    with patch.object(__main__, "get_settings"), patch.object(__main__.uvicorn, "run") as run:
        __main__.main()
    assert run.call_args.kwargs["access_log"] is False


@pytest.mark.parametrize("status", [400, 403, 413])
def test_correlation_covers_security_rejections(client, status):
    if status == 400:
        response = client.get("/", headers={"Host": "untrusted.example"})
    elif status == 403:
        response = client.post(
            "/api/collections",
            json={"name": "denied"},
            headers={"Origin": "https://untrusted.example"},
        )
    else:
        response = client.post("/api/search", content=b"x" * 16385)
    assert response.status_code == status
    assert len(response.headers["x-request-id"]) == 32

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from time import monotonic
from uuid import uuid4

from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if identifier := getattr(record, "request_id", None) or request_id.get():
            payload["request_id"] = identifier
        for field in (
            "dependency",
            "error_type",
            "operation",
            "outcome",
            "duration_ms",
            "method",
            "route",
            "status_code",
        ):
            if (value := getattr(record, field, None)) is not None:
                payload[field] = value
        return json.dumps(payload)


def configure_logging(level: str) -> None:
    logger = logging.getLogger("app")
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.handlers = [handler]
    logger.setLevel(level)
    logger.propagate = False


class RequestDiagnosticsMiddleware:
    """Server-generated correlation; never serialize URLs, headers or request bodies."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        identifier = uuid4().hex
        token = request_id.set(identifier)
        started, status = monotonic(), 500

        async def correlated(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message["headers"] = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"x-request-id"
                ] + [(b"x-request-id", identifier.encode("ascii"))]
            await send(message)

        try:
            await self.app(scope, receive, correlated)
        finally:
            # Only framework route templates: never raw paths/UUIDs or query strings.
            route = getattr(scope.get("route"), "path", "unmatched")
            method = scope.get("method", "OTHER")
            try:
                logging.getLogger("app.requests").info(
                    "Request completed",
                    extra={
                        "route": route,
                        "method": method
                        if method in {"GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS", "PUT"}
                        else "OTHER",
                        "status_code": status,
                        "request_id": identifier,
                        "duration_ms": round((monotonic() - started) * 1000, 2),
                    },
                )
            finally:
                request_id.reset(token)


def operation_timing(operation: str, started: float, *, completed: bool) -> None:
    """Call only with fixed operation names, never document IDs or user inputs."""
    logging.getLogger("app.operations").info(
        "Operation completed",
        extra={
            "operation": operation,
            "outcome": "completed" if completed else "failed",
            "duration_ms": round((monotonic() - started) * 1000, 2),
        },
    )


def stage_timing(operation: str, duration_ms: float) -> None:
    logging.getLogger("app.operations").info(
        "Answer stage completed",
        extra={"operation": operation, "duration_ms": round(duration_ms, 2)},
    )

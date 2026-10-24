from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class UploadLimitMiddleware:
    """Bound the entire multipart request before/during Starlette's spool parsing."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.limit = max_bytes + 64 * 1024  # Bounded allowance for multipart headers/fields.

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or not (path.startswith("/api/collections/") and path.endswith("/documents"))
        ):
            await self.app(scope, receive, send)
            return
        detail = {
            "code": "upload_too_large",
            "message": "Upload request exceeds the configured limit",
        }
        headers = dict(scope.get("headers", []))
        try:
            declared_length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            await JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)(
                scope, receive, send
            )
            return
        if declared_length > self.limit:
            await JSONResponse({"detail": detail}, status_code=413)(scope, receive, send)
            return
        received = 0

        async def bounded_receive() -> Message:
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > self.limit:
                raise HTTPException(status_code=413, detail=detail)
            return message

        await self.app(scope, bounded_receive, send)

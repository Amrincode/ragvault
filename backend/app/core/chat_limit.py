from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class ChatBodyLimitMiddleware:
    """Bound JSON before parsing, including unknown fields and chunked requests."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if scope["type"] != "http" or not (
            path == "/api/chat" or path.startswith("/api/conversations")
        ):
            await self.app(scope, receive, send)
            return
        limit = 16384
        headers = dict(scope.get("headers", []))
        try:
            size = int(headers.get(b"content-length", b"0"))
        except ValueError:
            size = limit + 1
        detail = {"code": "chat_body_too_large", "message": "Chat request exceeds 16 KiB"}
        if size > limit:
            await JSONResponse({"detail": detail}, status_code=413)(scope, receive, send)
            return
        received = 0

        async def bounded_receive() -> Message:
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > limit:
                raise HTTPException(413, detail=detail)
            return message

        await self.app(scope, bounded_receive, send)

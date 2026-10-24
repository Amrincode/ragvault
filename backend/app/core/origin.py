from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class LibraryOriginMiddleware:
    """Reject browser cross-origin writes; native clients without Origin remain supported."""

    def __init__(self, app: ASGIApp, allowed_origins: list[str]) -> None:
        self.app = app
        self.allowed_origins = set(allowed_origins)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in {"POST", "PATCH", "DELETE"}:
            origin = dict(scope.get("headers", [])).get(b"origin")
            if origin is not None and origin.decode("latin-1") not in self.allowed_origins:
                await JSONResponse(
                    status_code=403,
                    content={
                        "detail": {
                            "code": "origin_not_allowed",
                            "message": "This origin may not modify the local library",
                        }
                    },
                )(scope, receive, send)
                return
        await self.app(scope, receive, send)

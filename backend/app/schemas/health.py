from typing import Literal

from pydantic import BaseModel


class DependencyHealth(BaseModel):
    status: Literal["connected", "unavailable"]
    detail: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    application: Literal["ok"] = "ok"
    database: DependencyHealth
    ollama: DependencyHealth

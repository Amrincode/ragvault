from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import Engine

from app.db.session import check_database, get_engine
from app.schemas.health import HealthResponse
from app.services.ollama import OllamaClient, get_ollama

router = APIRouter(prefix="/api", tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    response_model_exclude_none=True,
    responses={
        503: {"model": HealthResponse, "description": "One or more dependencies unavailable"}
    },
)
def health(
    response: Response,
    engine: Annotated[Engine, Depends(get_engine)],
    ollama: Annotated[OllamaClient, Depends(get_ollama)],
) -> HealthResponse:
    database_health = check_database(engine)
    ollama_health = ollama.check_health()
    healthy = database_health.status == "connected" and ollama_health.status == "connected"
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    response.headers["Cache-Control"] = "no-store"
    return HealthResponse(
        status="ok" if healthy else "degraded", database=database_health, ollama=ollama_health
    )

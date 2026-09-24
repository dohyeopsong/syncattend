"""
Syncattend backend (FastAPI) — application entrypoint.

Owner: A (backend). Implements the contract in ../contracts/openapi.yaml.
Wires the real feature routers (auth, devices, courses, sessions, attendance, sse),
structured logging + request-ID middleware, and a /health check that probes
DB and Redis connectivity.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.config import get_settings
from app.db import get_sessionmaker
from app.observability import RequestIDMiddleware, configure_logging
from app.redis_client import get_redis
from app.routers import attendance, auth, courses, devices, sessions, sse
from app.schemas import Health

settings = get_settings()
configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the Redis client on startup; close it on shutdown.
    redis = get_redis()
    try:
        yield
    finally:
        try:
            await redis.aclose()
        except Exception:
            pass


app = FastAPI(
    title="Syncattend (SDAS) API", version=settings.version, lifespan=lifespan
)

app.add_middleware(RequestIDMiddleware)

# Web dashboard (owner C) runs on :5173 in dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _check_db() -> str:
    try:
        async with get_sessionmaker()() as session:
            await session.execute(text("SELECT 1"))
        return "ok"
    except Exception:
        return "down"


async def _check_redis() -> str:
    try:
        await get_redis().ping()
        return "ok"
    except Exception:
        return "down"


@app.get("/health", response_model=Health, tags=["health"], operation_id="getHealth")
async def get_health() -> Health:
    """Liveness + dependency check — contract operationId: getHealth."""
    db_status = await _check_db()
    redis_status = await _check_redis()
    overall = "ok" if db_status == "ok" and redis_status == "ok" else "degraded"
    return Health(
        status=overall,
        service=settings.app_name,
        version=settings.version,
        db=db_status,
        redis=redis_status,
    )


app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(courses.router)
app.include_router(courses.me_router)
app.include_router(sessions.router)
app.include_router(attendance.router)
app.include_router(sse.router)

"""
Syncattend backend (FastAPI) — scaffold entrypoint.

Owner: A (backend). Implements the contract in ../contracts/openapi.yaml.
Only the /health endpoint is wired in this scaffold; feature routers
(auth, devices, sessions, attendance, sse) are stubbed for parallel work.
"""
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings

settings = get_settings()

app = FastAPI(title="Syncattend (SDAS) API", version=settings.version)

# Web dashboard (owner C) runs on :5173 in dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
async def get_health() -> dict:
    """Liveness check — contract operationId: getHealth."""
    return {"status": "ok", "service": settings.app_name, "version": settings.version}


# --- feature router stubs (to be implemented by owner A) --------------------
# Each router is mounted but intentionally empty so the app boots cleanly and
# teammates can see where endpoints will live.
auth_router = APIRouter(prefix="/auth", tags=["auth"])
devices_router = APIRouter(prefix="/devices", tags=["devices"])
sessions_router = APIRouter(prefix="/sessions", tags=["sessions"])
attendance_router = APIRouter(prefix="/attendance", tags=["attendance"])
sse_router = APIRouter(prefix="/sse", tags=["sse"])

for _r in (auth_router, devices_router, sessions_router, attendance_router, sse_router):
    app.include_router(_r)

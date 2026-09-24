"""
Health endpoint tests — now includes DB + Redis connectivity probing.

Uses the async `client` fixture (in-memory SQLite + fakeredis) so both
dependencies are reachable and /health reports "ok". Also verifies the
degraded path when the DB is unreachable.
"""
import pytest

from app import db as app_db


async def test_health_ok(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "syncattend-backend"
    assert body["db"] == "ok"
    assert body["redis"] == "ok"


async def test_health_sets_request_id_header(client):
    resp = await client.get("/health")
    assert resp.headers.get("X-Request-ID")


async def test_health_degraded_when_db_down(client, monkeypatch):
    async def _down():
        return "down"

    # Force the DB probe to report down.
    monkeypatch.setattr("app.main._check_db", _down)
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["db"] == "down"
    assert body["redis"] == "ok"

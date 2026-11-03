"""
Observability: structured JSON logging + request-ID middleware.

- configure_logging(): installs a JSON formatter on the root logger.
- RequestIDMiddleware: assigns/propagates an X-Request-ID per request, binds it
  to a ContextVar so log records include it, and logs one structured line per
  request with method, path, status, and duration.

Implemented as a PURE ASGI middleware (not BaseHTTPMiddleware) on purpose:
BaseHTTPMiddleware buffers the entire response body through an internal
anyio memory stream, which breaks streaming responses — SSE (EventSource)
clients never receive `onopen`/`onmessage` until the stream ends, so the
realtime dashboard stays stuck on its loading/skeleton state for the whole
open session. A pure ASGI wrapper passes each `send` message straight through
to the server, so SSE chunks flush immediately.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp

# Bound per-request; empty string when outside a request scope.
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")

REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID_BYTES = REQUEST_ID_HEADER.encode()


class _JsonFormatter(logging.Formatter):
    """Render each log record as a single-line JSON object."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = request_id_ctx.get()
        if rid:
            payload["request_id"] = rid
        # Merge structured extras (set via logger.info(..., extra={"extra": {...}})).
        extra = getattr(record, "extra", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON formatter on the root logger (idempotent)."""
    root = logging.getLogger()
    root.setLevel(level.upper())
    # Replace existing handlers so we don't double-log.
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler()
    handler.setFormatter(_JsonFormatter())
    root.addHandler(handler)


_logger = logging.getLogger("syncattend.request")


class RequestIDMiddleware:
    """Assign/propagate a request ID and emit one structured access-log line.

    Pure ASGI middleware: wraps `send` to inject the X-Request-ID header on the
    response start and logs one line when the response stream completes. It
    never buffers the body, so SSE/WebSocket streaming flushes each chunk
    immediately (unlike BaseHTTPMiddleware, which buffers and breaks SSE)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Incoming X-Request-ID (if the caller set one), else generate one.
        rid = _scope_header(scope, _REQUEST_ID_BYTES) or uuid.uuid4().hex
        token = request_id_ctx.set(rid)
        start = time.perf_counter()
        status_holder = {"status": 0}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                # Replace any existing X-Request-ID, then append ours.
                headers = [
                    (k, v)
                    for (k, v) in message.get("headers", [])
                    if k.lower() != _REQUEST_ID_BYTES
                ]
                headers.append((_REQUEST_ID_BYTES, rid.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            _logger.exception(
                "request_failed",
                extra={
                    "extra": {
                        "method": scope.get("method", ""),
                        "path": scope.get("path", ""),
                        "duration_ms": duration_ms,
                    }
                },
            )
            raise
        else:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            _logger.info(
                "request",
                extra={
                    "extra": {
                        "method": scope.get("method", ""),
                        "path": scope.get("path", ""),
                        "status": status_holder["status"],
                        "duration_ms": duration_ms,
                    }
                },
            )
        finally:
            request_id_ctx.reset(token)


def _scope_header(scope, name_bytes: bytes) -> str | None:
    """Read a header (bytes key) from an ASGI HTTP scope."""
    for k, v in scope.get("headers", []):
        if k.lower() == name_bytes:
            return v.decode("latin-1")
    return None

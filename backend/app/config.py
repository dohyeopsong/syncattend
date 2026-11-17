"""Application settings loaded from environment (12-factor)."""
from functools import lru_cache

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "syncattend-backend"
    version: str = "0.1.0"

    # Datastores (defaults match infra/docker-compose.yml)
    database_url: str = "postgresql+asyncpg://sdas:sdas@localhost:5432/sdas"
    redis_url: str = "redis://localhost:6379/0"

    # CORS: comma-separated list of allowed web origins. In dev only the Vite
    # server (:5173) is allowed; on Render set CORS_ORIGINS to the Vercel URL(s).
    # Stored as a plain string and split on commas (pydantic-settings would
    # otherwise try to JSON-parse a list-typed env var, which breaks on a bare URL).
    cors_origins: str = "http://localhost:5173"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    # Auth / identity-defense parameters (contract-aligned)
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_seconds: int = 3600                 # 1h access token
    refresh_token_ttl_seconds: int = 60 * 60 * 24 * 14   # 14d refresh token
    nonce_ttl_seconds: int = 15                          # QR / audio nonce rotation + TTL
    auth_window_seconds: int = 60                        # ~1-minute attendance window
    school_email_domain: str = "@wku.ac.kr"

    # Device re-registration email code
    reregister_code_ttl_seconds: int = 300               # 5 min
    reregister_code_length: int = 6

    # Signup email verification code (회원가입 이메일 인증)
    signup_code_ttl_seconds: int = 900                   # 15 min
    signup_code_length: int = 6

    # SMTP for email verification (team member's flow). When SMTP_USER /
    # SMTP_PASSWORD are unset, codes are logged instead of sent (dev stub).
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from_name: str = "Syncattend"

    # Resend (https://resend.com) — HTTP email API. Used INSTEAD of SMTP on
    # hosts that block outbound SMTP (e.g. Render free tier: "Network is
    # unreachable" on ports 465/587). When RESEND_API_KEY is set, _deliver()
    # routes through Resend's HTTPS endpoint; otherwise falls back to SMTP /
    # the dev stub. The "from" address must be a verified sender in Resend.
    resend_api_key: str | None = None
    # Required when RESEND_API_KEY is configured. Do not silently fall back to
    # Resend's test sender, which cannot deliver to arbitrary recipients.
    resend_from: str | None = None

    # Risk-group thresholds (SSE warning) — externalized boundaries.
    # danger  when absences >= risk_absence_threshold
    # warning when absences >= risk_warning_threshold (and < danger)
    risk_absence_threshold: int = 3
    risk_warning_threshold: int = 2

    # Observability
    log_level: str = "INFO"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def use_fake_redis(self) -> bool:
        return self.redis_url.startswith("fakeredis")


@lru_cache
def get_settings() -> Settings:
    return Settings()

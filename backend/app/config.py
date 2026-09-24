"""Application settings loaded from environment (12-factor)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "syncattend-backend"
    version: str = "0.1.0"

    # Datastores (defaults match infra/docker-compose.yml)
    database_url: str = "postgresql+asyncpg://sdas:sdas@localhost:5432/sdas"
    redis_url: str = "redis://localhost:6379/0"

    # Auth / identity-defense parameters (contract-aligned)
    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_seconds: int = 3600
    nonce_ttl_seconds: int = 15          # QR / audio nonce rotation + TTL
    auth_window_seconds: int = 60        # ~1-minute attendance window
    school_email_domain: str = "@wku.ac.kr"


@lru_cache
def get_settings() -> Settings:
    return Settings()

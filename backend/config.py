"""Centralized configuration (audit H7).

A single typed settings object read from the environment / `.env`, so deploying to
dev/staging/prod no longer requires code edits. `TMDB_API_KEY` is required, so a
misconfigured deploy fails fast at startup instead of returning `{"source": "error"}`
on every request.
"""
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # Required — the app cannot serve movie data without it (fail fast if missing).
    tmdb_api_key: str

    # Optional — features degrade gracefully when unset.
    groq_api_key: str = ""   # AI taste analysis + explanations (else deterministic fallback)
    omdb_api_key: str = ""   # IMDb/RT/Metacritic badges (else hidden)

    database_url: str = "sqlite:///./movie_night.db"
    allowed_origins: List[str] = ["http://localhost:3000"]

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_csv(cls, v):
        # Allow ALLOWED_ORIGINS to be a comma-separated string in the environment.
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v


# Instantiated at import → validation (and the required-key check) happens at startup.
settings = Settings()

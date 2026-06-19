"""One app-lifetime pooled HTTP client (audit H2).

Every TMDB/OMDb call previously opened a fresh `httpx.AsyncClient`, discarding connection
pooling + TLS reuse and adding latency. This shares a single client (created lazily,
closed on shutdown via the lifespan hook in `main.py`).
"""
from typing import Optional

import httpx

_client: Optional[httpx.AsyncClient] = None


def get_http_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _client


async def close_http_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None

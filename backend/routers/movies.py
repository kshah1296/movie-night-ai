import os
from datetime import date
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

TMDB_BASE_URL = "https://api.themoviedb.org/3"
OMDB_BASE_URL = "https://www.omdbapi.com/"

# Process-lifetime cache for external ratings (OMDb free tier = 1000/day; ratings change slowly)
_ratings_cache: dict = {}

ALLOWED_SORTS = {
    "popularity.desc",
    "vote_average.desc",
    "primary_release_date.desc",
    "revenue.desc",
}


def tmdb_key():
    key = os.getenv("TMDB_API_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="TMDB_API_KEY not configured")
    return key


async def _tmdb_get(path: str, params: dict) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{TMDB_BASE_URL}{path}",
            params={"api_key": tmdb_key(), **params},
            timeout=10,
        )
    resp.raise_for_status()
    return resp.json()


@router.get("/trending")
async def get_trending(page: int = Query(1, ge=1, le=500)):
    return await _tmdb_get("/trending/movie/week", {"page": page})


@router.get("/discover")
async def discover_movies(
    page: int = Query(1, ge=1, le=500),
    sort_by: str = Query("popularity.desc"),
    genres: Optional[str] = Query(None, description="Comma-separated TMDB genre ids (AND semantics)"),
    year_gte: Optional[int] = Query(None, ge=1900, le=2100, description="Earliest release year"),
    year_lte: Optional[int] = Query(None, ge=1900, le=2100, description="Latest release year"),
    min_rating: Optional[float] = Query(None, ge=0, le=10, description="Minimum TMDB vote average"),
    runtime_gte: Optional[int] = Query(None, ge=0, le=400, description="Minimum runtime, minutes"),
    runtime_lte: Optional[int] = Query(None, ge=0, le=400, description="Maximum runtime, minutes"),
    providers: Optional[str] = Query(None, description="Comma-separated watch-provider ids (OR semantics, US region)"),
    people: Optional[str] = Query(None, description="Comma-separated TMDB person ids (cast OR crew)"),
    keywords: Optional[str] = Query(None, description="Comma-separated TMDB keyword ids (OR semantics)"),
):
    """Flexible TMDB /discover/movie proxy. Replaces the old /popular and /top_rated routes."""
    if sort_by not in ALLOWED_SORTS:
        raise HTTPException(status_code=400, detail=f"sort_by must be one of {sorted(ALLOWED_SORTS)}")

    params = {"include_adult": False, "sort_by": sort_by, "page": page}
    if genres:
        params["with_genres"] = genres
    if year_gte is not None:
        params["primary_release_date.gte"] = f"{year_gte}-01-01"
    if year_lte is not None:
        params["primary_release_date.lte"] = f"{year_lte}-12-31"
    if min_rating is not None:
        params["vote_average.gte"] = min_rating
        params["vote_count.gte"] = 200  # a 9.0 with 12 votes is noise, not a find
    if runtime_gte is not None:
        params["with_runtime.gte"] = runtime_gte
    if runtime_lte is not None:
        params["with_runtime.lte"] = runtime_lte
    if providers:
        # TMDB: pipe = OR, comma = AND. We accept commas from the client and convert to OR.
        params["with_watch_providers"] = providers.replace(",", "|")
        params["watch_region"] = "US"
        params["with_watch_monetization_types"] = "flatrate|free|ads"
    if people:
        params["with_people"] = people
    if keywords:
        # TMDB: pipe = OR, comma = AND. We accept commas from the client and convert to OR.
        params["with_keywords"] = keywords.replace(",", "|")

    # Quality floors so sorts don't surface junk (setdefault: never override the filters above)
    if sort_by == "vote_average.desc":
        params.setdefault("vote_count.gte", 300)
    elif sort_by == "primary_release_date.desc":
        params.setdefault("vote_count.gte", 20)
        params.setdefault("primary_release_date.lte", date.today().isoformat())

    return await _tmdb_get("/discover/movie", params)


@router.get("/search")
async def search_movies(
    q: str = Query(..., min_length=1),
    page: int = Query(1, ge=1, le=500),
    year: Optional[int] = Query(None, ge=1900, le=2100),
):
    params = {"query": q, "include_adult": False, "page": page}
    if year is not None:
        params["primary_release_year"] = year
    return await _tmdb_get("/search/movie", params)


# Must be defined BEFORE /{tmdb_id} — otherwise "person_search" is captured by the
# int path param and returns 422 (same shadowing rule as /providers below).
@router.get("/person_search")
async def search_people(q: str = Query(..., min_length=2)):
    """TMDB /search/person proxy, slimmed to what the UI needs."""
    data = await _tmdb_get("/search/person", {"query": q, "include_adult": False})
    people = []
    for p in data.get("results", [])[:5]:
        known_for = [kf.get("title") or kf.get("name") or "" for kf in p.get("known_for", [])]
        people.append({
            "id": p.get("id"),
            "name": p.get("name", ""),
            "profile_path": p.get("profile_path"),
            "known_for_department": p.get("known_for_department", ""),
            "known_for": [t for t in known_for if t][:3],
        })
    return people


# Must be defined BEFORE /{tmdb_id} to avoid route shadowing
@router.get("/{tmdb_id}/providers")
async def get_movie_providers(tmdb_id: int):
    data = await _tmdb_get(f"/movie/{tmdb_id}/watch/providers", {})
    return data.get("results", {}).get("US", {})


# Must be defined BEFORE /{tmdb_id} to avoid route shadowing.
# External critic/audience scores via OMDb (IMDb + Rotten Tomatoes + Metacritic).
# Degrades gracefully to {} when OMDB_API_KEY is unset or the movie has no IMDb id.
@router.get("/{tmdb_id}/ratings")
async def get_movie_ratings(tmdb_id: int):
    if tmdb_id in _ratings_cache:
        return _ratings_cache[tmdb_id]

    omdb_key = os.getenv("OMDB_API_KEY")
    if not omdb_key:
        return {}

    def clean(v):
        return v if v not in (None, "", "N/A") else None

    try:
        detail = await _tmdb_get(f"/movie/{tmdb_id}", {})
        imdb_id = detail.get("imdb_id")
        if not imdb_id:
            return {}
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                OMDB_BASE_URL,
                params={"i": imdb_id, "apikey": omdb_key},
                timeout=10,
            )
        data = resp.json() if resp.status_code == 200 else {}
    except Exception:
        return {}

    if not data or data.get("Response") == "False":
        return {}

    by_source = {r.get("Source"): r.get("Value") for r in data.get("Ratings", [])}
    metascore = clean(data.get("Metascore"))
    result = {
        "imdb": clean(data.get("imdbRating")),                 # e.g. "8.8"
        "imdb_votes": clean(data.get("imdbVotes")),            # e.g. "2,400,123"
        "imdb_id": imdb_id,                                    # for a deep link
        "rotten_tomatoes": clean(by_source.get("Rotten Tomatoes")),  # e.g. "91%"
        "metacritic": (f"{metascore}/100" if metascore else clean(by_source.get("Metacritic"))),
    }
    # Only cache real results so a transient OMDb hiccup can be retried.
    if any(result.get(k) for k in ("imdb", "rotten_tomatoes", "metacritic")):
        _ratings_cache[tmdb_id] = result
    return result


@router.get("/{tmdb_id}")
async def get_movie(tmdb_id: int):
    return await _tmdb_get(
        f"/movie/{tmdb_id}",
        {"append_to_response": "credits,videos"},
    )

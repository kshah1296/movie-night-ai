import asyncio
import json
import logging
import os
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.http_client import get_http_client
from backend.models import MovieFacets, MovieMetaCache, MovieRatingsCache

router = APIRouter()
logger = logging.getLogger("movienight.movies")

TMDB_BASE_URL = "https://api.themoviedb.org/3"
OMDB_BASE_URL = "https://www.omdbapi.com/"

# External ratings (OMDb free tier = 1000/day) are cached in the DB; refresh past this age.
RATINGS_TTL = timedelta(days=14)
RATINGS_BATCH_MAX = 30   # hard cap on ids per batch request
RATINGS_CONCURRENCY = 5  # max simultaneous OMDb fetches

# Watchlist meta (runtime + streaming providers) — providers drift, so a shorter TTL.
META_TTL = timedelta(days=7)
META_BATCH_MAX = 80

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
    client = get_http_client()  # shared pooled client (audit H2)
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


_RATING_FIELDS = ("imdb", "imdb_votes", "imdb_id", "rotten_tomatoes", "metacritic")


def _row_to_dict(row: MovieRatingsCache) -> dict:
    return {f: getattr(row, f) for f in _RATING_FIELDS}


def _is_fresh(row: MovieRatingsCache) -> bool:
    return bool(row.fetched_at) and (datetime.utcnow() - row.fetched_at) < RATINGS_TTL


def _upsert_ratings(db: Session, tmdb_id: int, data: dict) -> None:
    row = db.get(MovieRatingsCache, tmdb_id)
    if row is None:
        row = MovieRatingsCache(tmdb_id=tmdb_id)
        db.add(row)
    for f in _RATING_FIELDS:
        setattr(row, f, data.get(f))
    row.fetched_at = datetime.utcnow()


async def _fetch_omdb_ratings(tmdb_id: int, omdb_key: str,
                              imdb_id: Optional[str] = None) -> Optional[dict]:
    """Fetch external scores from OMDb. Returns a dict (possibly empty values) on a
    successful response, or None on a transient/unfetchable failure (don't cache None).
    `imdb_id` may be supplied from the movie_facets cache to skip a TMDB round-trip (audit H3)."""
    def clean(v):
        return v if v not in (None, "", "N/A") else None

    if not imdb_id:  # cache miss — resolve the IMDb id from TMDB
        try:
            detail = await _tmdb_get(f"/movie/{tmdb_id}", {})
        except httpx.HTTPError as e:
            logger.warning("TMDB lookup for imdb_id failed (tmdb_id=%s): %s", tmdb_id, e)
            return None
        imdb_id = detail.get("imdb_id")
    if not imdb_id:
        return {f: None for f in _RATING_FIELDS}  # permanent: no IMDb id → cacheable empty

    try:
        resp = await get_http_client().get(
            OMDB_BASE_URL, params={"i": imdb_id, "apikey": omdb_key}, timeout=10
        )
        data = resp.json() if resp.status_code == 200 else None
    except httpx.HTTPError as e:
        logger.warning("OMDb request failed (imdb_id=%s): %s", imdb_id, e)
        return None

    if not data or data.get("Response") == "False":
        return None  # could be rate-limit/transient — retry next time

    by_source = {r.get("Source"): r.get("Value") for r in data.get("Ratings", [])}
    metascore = clean(data.get("Metascore"))
    return {
        "imdb": clean(data.get("imdbRating")),
        "imdb_votes": clean(data.get("imdbVotes")),
        "imdb_id": imdb_id,
        "rotten_tomatoes": clean(by_source.get("Rotten Tomatoes")),
        "metacritic": (f"{metascore}/100" if metascore else clean(by_source.get("Metacritic"))),
    }


# Batch route — MUST be declared before /{tmdb_id} (and /{tmdb_id}/ratings) so the
# literal "ratings" segment isn't captured by the int path param.
@router.get("/ratings")
async def get_movie_ratings_batch(
    ids: str = Query(..., description="Comma-separated TMDB movie ids"),
    db: Session = Depends(get_db),
):
    id_list, seen = [], set()
    for part in ids.split(","):
        part = part.strip()
        if part.isdigit():
            tid = int(part)
            if tid not in seen:
                seen.add(tid)
                id_list.append(tid)
    id_list = id_list[:RATINGS_BATCH_MAX]

    result: dict = {}
    misses = []
    for tid in id_list:
        row = db.get(MovieRatingsCache, tid)
        if row is not None and _is_fresh(row):
            result[str(tid)] = _row_to_dict(row)
        else:
            misses.append(tid)

    omdb_key = os.getenv("OMDB_API_KEY")
    if omdb_key and misses:
        # Pull any cached IMDb ids in one query so OMDb fetches skip the per-movie TMDB call.
        imdb_ids = {
            row.tmdb_id: row.imdb_id
            for row in db.query(MovieFacets.tmdb_id, MovieFacets.imdb_id)
            .filter(MovieFacets.tmdb_id.in_(misses)).all()
        }
        sem = asyncio.Semaphore(RATINGS_CONCURRENCY)

        async def fetch_one(tid: int):
            async with sem:
                return tid, await _fetch_omdb_ratings(tid, omdb_key, imdb_ids.get(tid))

        # Fetch concurrently, then write sequentially (single Session is not concurrency-safe).
        for tid, data in await asyncio.gather(*(fetch_one(t) for t in misses)):
            if data is None:
                row = db.get(MovieRatingsCache, tid)  # serve stale on transient failure
                result[str(tid)] = _row_to_dict(row) if row else {}
            else:
                result[str(tid)] = data
                _upsert_ratings(db, tid, data)
        db.commit()
    else:
        for tid in misses:
            row = db.get(MovieRatingsCache, tid)
            result[str(tid)] = _row_to_dict(row) if row else {}

    return result


# Batch runtime + US streaming providers for the watchlist sort/filter. MUST be declared
# before /{tmdb_id} (the literal "meta" segment would otherwise hit the int path param).
@router.get("/meta")
async def get_movie_meta_batch(
    ids: str = Query(..., description="Comma-separated TMDB movie ids"),
    db: Session = Depends(get_db),
):
    id_list, seen = [], set()
    for part in ids.split(","):
        part = part.strip()
        if part.isdigit() and int(part) not in seen:
            seen.add(int(part))
            id_list.append(int(part))
    id_list = id_list[:META_BATCH_MAX]

    result: dict = {}
    misses = []
    now = datetime.utcnow()
    for tid in id_list:
        row = db.get(MovieMetaCache, tid)
        if row is not None and row.fetched_at and (now - row.fetched_at) < META_TTL:
            result[str(tid)] = {"runtime": row.runtime,
                                "providers": json.loads(row.provider_ids or "[]")}
        else:
            misses.append(tid)

    if misses:
        sem = asyncio.Semaphore(RATINGS_CONCURRENCY)

        async def fetch_one(tid: int):
            async with sem:
                try:
                    return tid, await _tmdb_get(f"/movie/{tid}", {"append_to_response": "watch/providers"})
                except httpx.HTTPError as e:
                    logger.warning("TMDB meta fetch failed (tmdb_id=%s): %s", tid, e)
                    return tid, None

        for tid, data in await asyncio.gather(*(fetch_one(t) for t in misses)):
            if not data or not data.get("id"):
                row = db.get(MovieMetaCache, tid)  # serve stale on a transient failure
                result[str(tid)] = ({"runtime": row.runtime,
                                     "providers": json.loads(row.provider_ids or "[]")}
                                    if row else {"runtime": None, "providers": []})
                continue
            runtime = data.get("runtime")
            us = (data.get("watch/providers", {}) or {}).get("results", {}).get("US", {})
            prov_ids = [p["provider_id"] for p in us.get("flatrate", []) if p.get("provider_id")]
            result[str(tid)] = {"runtime": runtime, "providers": prov_ids}
            existing = db.get(MovieMetaCache, tid)
            if existing is None:
                existing = MovieMetaCache(tmdb_id=tid)
                db.add(existing)
            existing.runtime = runtime
            existing.provider_ids = json.dumps(prov_ids)
            existing.fetched_at = now
        db.commit()

    return result


# Must be defined BEFORE /{tmdb_id} to avoid route shadowing.
# External critic/audience scores via OMDb (IMDb + Rotten Tomatoes + Metacritic).
# Degrades gracefully to {} when OMDB_API_KEY is unset or the movie has no IMDb id.
@router.get("/{tmdb_id}/ratings")
async def get_movie_ratings(tmdb_id: int, db: Session = Depends(get_db)):
    row = db.get(MovieRatingsCache, tmdb_id)
    if row is not None and _is_fresh(row):
        return _row_to_dict(row)

    omdb_key = os.getenv("OMDB_API_KEY")
    if not omdb_key:
        return _row_to_dict(row) if row else {}

    facet = db.get(MovieFacets, tmdb_id)  # cached IMDb id skips a TMDB round-trip (audit H3)
    data = await _fetch_omdb_ratings(tmdb_id, omdb_key, facet.imdb_id if facet else None)
    if data is None:
        return _row_to_dict(row) if row else {}  # serve stale on transient failure

    _upsert_ratings(db, tmdb_id, data)
    db.commit()
    return data


@router.get("/{tmdb_id}")
async def get_movie(tmdb_id: int):
    return await _tmdb_get(
        f"/movie/{tmdb_id}",
        {"append_to_response": "credits,videos"},
    )

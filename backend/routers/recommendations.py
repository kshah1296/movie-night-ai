import asyncio
import hashlib
import json
import os
import random
import time
from collections import Counter
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple

from groq import Groq
import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import MovieFacets, Rating, RecFeedback, TasteAnalysis, WatchlistItem

router = APIRouter()

TMDB_BASE_URL = "https://api.themoviedb.org/3"

GENRE_MAP = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
    878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
}
GENRE_NAME_TO_ID = {v: k for k, v in GENRE_MAP.items()}

# TMDB keywords that carry no taste signal — never profiled, never searched on.
STOP_KEYWORDS = {
    "aftercreditsstinger", "duringcreditsstinger", "based on novel or book",
    "woman director", "based on comic", "based on true story", "remake",
    "sequel", "3d", "imax",
}

# Mood presets: genres are OR-joined, keywords merge into the keyword channel,
# "ask" goes verbatim into the ranking prompt's TONIGHT'S REQUEST block.
MOODS: Dict[str, dict] = {
    "cozy": {
        "label": "Cozy",
        "genres": [35, 10751, 18],
        "keywords": ["feel good", "heartwarming", "friendship"],
        "runtime_lte": 115,
        "ask": "a cozy, low-stakes comfort watch — warm, funny or gently moving, nothing bleak or violent",
    },
    "mind-bender": {
        "label": "Mind-bender",
        "genres": [878, 9648, 53],
        "keywords": ["twist ending", "time loop", "psychological thriller"],
        "runtime_lte": None,
        "ask": "a cerebral mind-bender — twisty, layered, the kind of film you discuss afterward",
    },
    "date-night": {
        "label": "Date night",
        "genres": [10749, 35, 18],
        "keywords": ["romantic comedy", "love", "romance"],
        "runtime_lte": 130,
        "ask": "a date-night movie — romantic or charming, broadly appealing, never grim",
    },
    "adrenaline": {
        "label": "Adrenaline",
        "genres": [28, 53, 80],
        "keywords": ["heist", "car chase", "survival"],
        "runtime_lte": 140,
        "ask": "a pure adrenaline ride — propulsive action or thriller with relentless momentum",
    },
}

# {fingerprint: (timestamp, full response payload)}
_cache: Dict[str, Tuple[float, dict]] = {}
CACHE_TTL = 300  # 5 minutes

# name -> TMDB id (None = searched, no match). In-process; cheap to rebuild on restart.
_keyword_id_cache: Dict[str, Optional[int]] = {}
_person_id_cache: Dict[str, Optional[int]] = {}

ENRICH_BATCH_LIMIT = 15  # max facet fetches per request; the backlog drains across requests


async def _tmdb_get(client: httpx.AsyncClient, path: str, params: dict) -> dict:
    try:
        resp = await client.get(f"{TMDB_BASE_URL}{path}", params=params, timeout=6)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return {}


# ── Stage 0: facet enrichment (cached in SQLite) ────────────────────────────

async def _ensure_facets(db: Session, tmdb_key: str, items: list) -> Dict[int, dict]:
    """items: ORM objects with .tmdb_id. Returns {tmdb_id: facets dict}, fetching
    and persisting keywords/credits for any movie not yet in movie_facets."""
    ids = list({it.tmdb_id for it in items})
    facets: Dict[int, dict] = {}
    if ids:
        rows = db.query(MovieFacets).filter(MovieFacets.tmdb_id.in_(ids)).all()
        for row in rows:
            facets[row.tmdb_id] = {
                "keywords": json.loads(row.keywords or "[]"),
                "directors": json.loads(row.directors or "[]"),
                "top_cast": json.loads(row.top_cast or "[]"),
                "original_language": row.original_language,
                "runtime": row.runtime,
                "year": row.year,
            }

    missing = [i for i in ids if i not in facets][:ENRICH_BATCH_LIMIT]
    if not missing:
        return facets

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[
            _tmdb_get(client, "/movie/%d" % mid,
                      {"api_key": tmdb_key, "append_to_response": "keywords,credits"})
            for mid in missing
        ])

    for mid, data in zip(missing, results):
        if not data or not data.get("id"):
            continue
        kws = [k.get("name", "") for k in data.get("keywords", {}).get("keywords", [])][:15]
        kws = [k for k in kws if k]
        directors = [[c["id"], c["name"]] for c in data.get("credits", {}).get("crew", [])
                     if c.get("job") == "Director"][:2]
        top_cast = [[c["id"], c["name"]] for c in data.get("credits", {}).get("cast", [])[:5]]
        year = int(data["release_date"][:4]) if data.get("release_date") else None
        f = {
            "keywords": kws, "directors": directors, "top_cast": top_cast,
            "original_language": data.get("original_language"),
            "runtime": data.get("runtime"), "year": year,
        }
        facets[mid] = f
        db.merge(MovieFacets(
            tmdb_id=mid, keywords=json.dumps(kws), directors=json.dumps(directors),
            top_cast=json.dumps(top_cast), original_language=f["original_language"],
            runtime=f["runtime"], year=year,
        ))
    db.commit()
    return facets


# ── Stage 1: weighted taste profile ─────────────────────────────────────────

def _build_profile(ratings: List[Rating], watchlist: List[WatchlistItem],
                   facets: Dict[int, dict]) -> dict:
    loved = [r for r in ratings if r.rating >= 4]
    liked = [r for r in ratings if r.rating == 3]
    disliked = [r for r in ratings if r.rating <= 2]
    want = [w for w in watchlist if not w.watched]

    def genres_of(items):
        ids = []
        for it in items:
            try:
                names = json.loads(it.genres) if it.genres else []
            except Exception:
                names = []
            ids += [GENRE_NAME_TO_ID[n] for n in names if n in GENRE_NAME_TO_ID]
        return ids

    loved_genres = Counter(genres_of(loved) + genres_of(want))
    disliked_genres = Counter(genres_of(disliked))

    kw_scores: Counter = Counter()
    people_scores: Dict[int, dict] = {}
    decades: Counter = Counter()
    languages: Counter = Counter()

    def absorb(tmdb_id: int, weight: int):
        f = facets.get(tmdb_id)
        if not f:
            return
        for kw in f["keywords"]:
            if kw.lower() not in STOP_KEYWORDS:
                kw_scores[kw] += weight
        if weight > 0:
            for pid, name in f["directors"]:
                entry = people_scores.setdefault(pid, {"name": name, "score": 0, "role": "director"})
                entry["score"] += weight * 2
            for pid, name in f["top_cast"]:
                entry = people_scores.setdefault(pid, {"name": name, "score": 0, "role": "actor"})
                entry["score"] += weight
            if f.get("year"):
                decades[(f["year"] // 10) * 10] += weight
            if f.get("original_language"):
                languages[f["original_language"]] += weight

    for r in ratings:
        absorb(r.tmdb_id, int(r.rating) - 3)   # 5★=+2, 4★=+1, 3★=0, 2★=−1, 1★=−2
    for w in want:
        absorb(w.tmdb_id, 1)                   # watchlist intent = mild positive

    top_keywords = [kw for kw, s in kw_scores.most_common(30) if s >= 2][:12]
    avoid_keywords = [kw for kw, s in sorted(kw_scores.items(), key=lambda kv: kv[1])[:10]
                      if s <= -2][:6]

    loved_people: List[Tuple[int, str, str]] = [
        (pid, e["name"], e["role"])
        for pid, e in sorted(people_scores.items(), key=lambda kv: kv[1]["score"], reverse=True)
        if e["score"] >= 3
    ][:5]

    top_decade = None
    if decades:
        dec, cnt = decades.most_common(1)[0]
        if cnt >= 3:
            top_decade = dec

    fav_languages = [lang for lang, c in languages.most_common(3) if lang != "en" and c >= 2]

    return {
        "loved": loved, "liked": liked, "disliked": disliked, "want": want,
        "loved_genres": loved_genres, "disliked_genres": disliked_genres,
        "top_keywords": top_keywords, "avoid_keywords": avoid_keywords,
        "loved_people": loved_people, "top_decade": top_decade,
        "fav_languages": fav_languages,
    }


def _profile_text(profile: dict) -> str:
    def fmt(items):
        return ", ".join("%s (%s) %d★" % (r.title, r.year or "—", int(r.rating))
                         for r in items[:15])
    parts = []
    if profile["loved"]:
        parts.append("LOVED (4-5★): " + fmt(profile["loved"]))
    if profile["liked"]:
        parts.append("LIKED (3★): " + fmt(profile["liked"]))
    if profile["disliked"]:
        parts.append("DISLIKED (1-2★, avoid anything similar): " + fmt(profile["disliked"]))
    if profile["want"]:
        parts.append("WANTS TO WATCH: " + ", ".join(w.title for w in profile["want"][:12]))
    if profile["top_keywords"]:
        parts.append("RECURRING THEMES in their loved films: " + ", ".join(profile["top_keywords"]))
    if profile["avoid_keywords"]:
        parts.append("THEMES THEY AVOID: " + ", ".join(profile["avoid_keywords"]))
    if profile["loved_people"]:
        parts.append("PEOPLE who keep showing up in their loved films: " +
                     ", ".join("%s (%s)" % (name, role) for _pid, name, role in profile["loved_people"]))
    if profile["top_decade"]:
        parts.append("FAVORITE ERA: the %ds" % profile["top_decade"])
    if profile["fav_languages"]:
        parts.append("Open to non-English films (languages: %s)" % ", ".join(profile["fav_languages"]))
    return "\n".join(parts)


# ── Stage 2: LLM taste reading (cached on ratings fingerprint) ───────────────

def _groq_taste_analysis(profile: dict, groq_key: str) -> Optional[dict]:
    """Groq call #1 — runs only when ratings change (result persisted in taste_analysis)."""
    client = Groq(api_key=groq_key)
    prompt = f"""You are a film-taste analyst. Study this user's viewing history and produce a
compact, machine-usable reading of their taste.

{_profile_text(profile)}

Respond ONLY with a valid JSON object (no markdown, no code fences) of this exact shape:
{{"tone": "1-2 sentences describing what this person actually values in films (pacing, mood, themes), written to the user as 'You ...'",
 "search_keywords": ["5-8 short keyword tags capturing their micro-genres"],
 "people": ["up to 4 directors or actors this user would likely follow, full names"],
 "wildcard": {{"keywords": ["1-2 keyword tags for a stretch pick just OUTSIDE their comfort zone but adjacent to it"]}}}}

Rules:
- search_keywords must be lowercase noun phrases of 1-3 words that plausibly exist as TMDB
  keyword tags (examples of the style: "heist", "time loop", "neo-noir", "slow burn",
  "coming of age", "found family", "space opera")
- never name people who are not connected to films in the profile
- if the profile is thin, return fewer items rather than guessing"""

    chat = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
    )
    text = chat.choices[0].message.content.strip()
    text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    data = json.loads(text[start:end + 1])
    if not isinstance(data, dict):
        return None
    wildcard = data.get("wildcard") if isinstance(data.get("wildcard"), dict) else {}
    return {
        "tone": str(data.get("tone", ""))[:300],
        "search_keywords": [str(k) for k in data.get("search_keywords", []) if isinstance(k, str)][:8],
        "people": [str(p) for p in data.get("people", []) if isinstance(p, str)][:4],
        "wildcard": wildcard,
    }


# ── TMDB resolvers (ground LLM strings into real ids — hallucination-proof) ──

async def _resolve_keyword_ids(client: httpx.AsyncClient, tmdb_key: str,
                               names: List[str]) -> List[int]:
    out: List[int] = []
    for name in names:
        key = str(name).strip().lower()
        if not key or key in STOP_KEYWORDS:
            continue
        if key not in _keyword_id_cache:
            data = await _tmdb_get(client, "/search/keyword", {"api_key": tmdb_key, "query": key})
            results = data.get("results", [])
            _keyword_id_cache[key] = results[0]["id"] if results else None
        kid = _keyword_id_cache[key]
        if kid is not None and kid not in out:
            out.append(kid)
    return out


async def _resolve_person_ids(client: httpx.AsyncClient, tmdb_key: str,
                              names: List[str]) -> List[int]:
    out: List[int] = []
    for name in names:
        key = str(name).strip().lower()
        if not key:
            continue
        if key not in _person_id_cache:
            data = await _tmdb_get(client, "/search/person",
                                   {"api_key": tmdb_key, "query": key, "include_adult": False})
            results = data.get("results", [])
            _person_id_cache[key] = results[0]["id"] if results else None
        pid = _person_id_cache[key]
        if pid is not None and pid not in out:
            out.append(pid)
    return out


# ── Stage 3: multi-channel candidate retrieval ───────────────────────────────

async def _candidate_pool_v2(profile: dict, analysis: dict, tmdb_key: str,
                             exclude: Set[int], recently_shown: Set[int], seed: int,
                             genre_id: Optional[int], mood: Optional[dict],
                             providers: Optional[str] = None) -> List[dict]:
    """Channels: [similar] (anchored), [keywords], [people], [hidden-gem], [popular],
    [wildcard]. Returns up to 36 channel-interleaved candidates.
    When providers is set, every discover channel is scoped to those streaming
    services and the [similar] channel is skipped (TMDB can't provider-filter it)."""
    rng = random.Random(seed)
    page = (seed % 8) + 1  # wider window so repeated refreshes don't recycle the same pages (P2-2)

    provider_params: dict = {}
    if providers:
        provider_params = {
            "with_watch_providers": providers.replace(",", "|"),  # pipe = OR
            "watch_region": "US",
            "with_watch_monetization_types": "flatrate|free|ads",
        }

    mode_genres: Optional[str] = None
    mode_keywords: List[str] = []
    runtime_lte: Optional[int] = None
    if genre_id:
        mode_genres = str(genre_id)
    elif mood:
        mode_genres = "|".join(str(g) for g in mood["genres"])  # pipe = OR in TMDB
        mode_keywords = list(mood["keywords"])
        runtime_lte = mood.get("runtime_lte")

    seeds = sorted(profile["loved"], key=lambda r: r.rating, reverse=True)[:8]
    rng.shuffle(seeds)
    seeds = seeds[:4]

    seen_kw: Set[str] = set()
    kw_names: List[str] = []
    for name in mode_keywords + list(analysis.get("search_keywords", [])) + profile["top_keywords"]:
        if isinstance(name, str) and name.lower() not in seen_kw:
            seen_kw.add(name.lower())
            kw_names.append(name)
    kw_names = kw_names[:8]

    people_ids: List[int] = [pid for pid, _name, _role in profile["loved_people"]][:4]

    # provider_params rides along in base, so every /discover channel inherits the
    # streaming-service scope automatically (similar specs don't use base)
    base = {"api_key": tmdb_key, "include_adult": False, **provider_params}
    specs: List[Tuple[str, Optional[str], str, dict]] = []  # (channel, anchor, path, params)

    if not providers:
        # similar lists can't be provider-filtered — only include them in unfiltered mode
        for s in seeds:
            specs.append(("similar", s.title, "/movie/%d/recommendations" % s.tmdb_id,
                          {"api_key": tmdb_key, "page": 1}))

    async with httpx.AsyncClient() as client:
        keyword_ids = await _resolve_keyword_ids(client, tmdb_key, kw_names)
        extra_people = await _resolve_person_ids(client, tmdb_key,
                                                 list(analysis.get("people", []))[:3])
        for pid in extra_people:
            if pid not in people_ids:
                people_ids.append(pid)

        if keyword_ids:
            p = dict(base)
            p.update({"with_keywords": "|".join(str(k) for k in keyword_ids),
                      "sort_by": "popularity.desc", "vote_count.gte": 100, "page": page})
            if mode_genres:
                p["with_genres"] = mode_genres
            if runtime_lte:
                p["with_runtime.lte"] = runtime_lte
            specs.append(("keywords", None, "/discover/movie", p))

            gem_kw = dict(p)
            gem_kw.update({"sort_by": "vote_average.desc", "vote_average.gte": 6.8,
                           "vote_count.gte": 150, "vote_count.lte": 3000, "page": 1})
            specs.append(("hidden-gem", None, "/discover/movie", gem_kw))

        if people_ids:
            p = dict(base)
            p.update({"with_people": "|".join(str(i) for i in people_ids[:5]),
                      "sort_by": "vote_average.desc", "vote_count.gte": 200, "page": 1})
            if mode_genres:
                p["with_genres"] = mode_genres
            specs.append(("people", None, "/discover/movie", p))

        # OR-join top-2 loved genres so the gem band has room to breathe
        gen = mode_genres or "|".join(
            str(g) for g, _cnt in profile["loved_genres"].most_common(2))
        if gen:
            p = dict(base)
            p.update({"with_genres": gen, "sort_by": "vote_average.desc",
                      "vote_average.gte": 7.0, "vote_count.gte": 200,
                      "vote_count.lte": 4000, "page": page})
            if profile["top_decade"] and not mood and seed % 2 == 1:
                p["primary_release_date.gte"] = "%d-01-01" % profile["top_decade"]
                p["primary_release_date.lte"] = "%d-12-31" % (profile["top_decade"] + 9)
            if runtime_lte:
                p["with_runtime.lte"] = runtime_lte
            specs.append(("hidden-gem", None, "/discover/movie", p))

            pop = dict(base)
            pop.update({"with_genres": gen, "sort_by": "popularity.desc",
                        "vote_count.gte": 300, "page": page})
            if runtime_lte:
                pop["with_runtime.lte"] = runtime_lte
            specs.append(("popular", None, "/discover/movie", pop))

        if not genre_id and not mood:
            wc = analysis.get("wildcard") or {}
            wc_ids = await _resolve_keyword_ids(client, tmdb_key,
                                                list(wc.get("keywords", []))[:2])
            if wc_ids:
                p = dict(base)
                p.update({"with_keywords": "|".join(str(k) for k in wc_ids),
                          "sort_by": "vote_average.desc", "vote_count.gte": 150, "page": 1})
                specs.append(("wildcard", None, "/discover/movie", p))

        results = await asyncio.gather(
            *[_tmdb_get(client, path, params) for _ch, _a, path, params in specs])

    mood_genre_set: Optional[Set[int]] = set(mood["genres"]) if mood else None
    disliked_genres = set(profile["disliked_genres"])
    pool: Dict[int, dict] = {}
    for (channel, anchor, _path, _params), data in zip(specs, results):
        for m in data.get("results", []):
            mid = m.get("id")
            if not mid or mid in exclude or not m.get("poster_path"):
                continue
            gids = m.get("genre_ids", [])
            if channel == "similar":
                # similar lists can't be genre-filtered server-side — do it here
                if genre_id is not None and genre_id not in gids:
                    continue
                if mood_genre_set is not None and not (mood_genre_set & set(gids)):
                    continue
            affinity = min(sum(profile["loved_genres"].get(g, 0) for g in set(gids)), 6)
            score = (
                affinity
                + m.get("vote_average", 0)
                - 3 * sum(1 for g in set(gids) if g in disliked_genres)
                - (5 if mid in recently_shown else 0)
                + (1.5 if channel in ("hidden-gem", "wildcard") else 0)
                + rng.uniform(0, 1.5)
            )
            if mid in pool:
                # multi-channel hit = stronger signal; keep first channel/anchor
                pool[mid]["_score"] = max(pool[mid]["_score"], score) + 0.5
                continue
            pool[mid] = {
                "tmdb_id": mid,
                "title": m.get("title", ""),
                "year": int(m["release_date"][:4]) if m.get("release_date") else None,
                "genres": [GENRE_MAP[g] for g in gids if g in GENRE_MAP],
                "poster_path": m.get("poster_path"),
                "vote_average": round(m.get("vote_average", 0), 1),
                "overview": m.get("overview", ""),
                "channel": channel,
                "anchor": anchor,
                "_score": score,
            }

    # Diversity: round-robin interleave channels (sorted by score within each)
    by_channel: Dict[str, List[dict]] = {}
    for cand in pool.values():
        by_channel.setdefault(cand["channel"], []).append(cand)
    for lst in by_channel.values():
        lst.sort(key=lambda x: x["_score"], reverse=True)

    ordered: List[dict] = []
    while any(by_channel.values()) and len(ordered) < 36:
        for ch in sorted(by_channel.keys()):
            if by_channel[ch] and len(ordered) < 36:
                ordered.append(by_channel[ch].pop(0))
    return ordered


# ── Stage 4: LLM rank & explain ──────────────────────────────────────────────

def _groq_rank_v2(profile: dict, analysis: dict, candidates: list, groq_key: str,
                  seed: int, mode_ask: Optional[str],
                  not_interested_titles: List[str]) -> Optional[List[dict]]:
    """Returns ordered [{tmdb_id, explanation, anchor}] or None on failure."""
    client = Groq(api_key=groq_key)
    cand_lines = []
    for c in candidates:
        tag = c["channel"]
        if c.get("anchor"):
            tag += ', similar to "%s"' % c["anchor"]
        overview = (c.get("overview") or "")[:140]
        cand_lines.append(
            f'{c["tmdb_id"]}: {c["title"]} ({c["year"]}) — {", ".join(c["genres"][:3])} — '
            f'{c["vote_average"]}★ [{tag}] — {overview}'
        )

    tone_block = f"\nTASTE READING: {analysis['tone']}\n" if analysis.get("tone") else ""
    rejected_block = (
        "\nRECENTLY REJECTED RECS (user clicked 'not interested' — avoid anything too similar): "
        + ", ".join(not_interested_titles) + "\n"
    ) if not_interested_titles else ""
    mode_block = (
        f"\nTONIGHT'S REQUEST: {mode_ask}\n"
        "Every pick MUST satisfy this request — taste-match within it, do not drift outside it.\n"
    ) if mode_ask else ""
    genre_rule = (
        "- Tonight is a single-genre/mood request, so ignore genre-diversity limits."
        if mode_ask else
        "- No more than 4 picks sharing the same primary genre."
    )

    prompt = f"""You are a film curator. Here is a user's taste profile:

{_profile_text(profile)}{tone_block}{rejected_block}{mode_block}
Below is a list of CANDIDATE movies (real TMDB ids), each tagged with the retrieval channel that
found it. Pick the 12 best matches for this user, ranked best-first. Selection rules:
- At least 3 picks from [hidden-gem] candidates when available — favor quality over popularity.
- Include exactly 1 [wildcard] pick if any are listed; frame its explanation as a stretch
  ("A step outside your usual, but...").
{genre_rule}
- Skip anything that resembles their DISLIKED films or rejected recs.
For each pick write a warm, specific 1-2 sentence reason naming an actual movie they LOVED and the
concrete trait it shares (tone, director, theme, pacing, era). Also return that loved movie's
title as "anchor".

CANDIDATES:
{chr(10).join(cand_lines)}

Respond ONLY with a valid JSON array (no markdown, no code fences). Use ONLY ids from the list:
[{{"tmdb_id": 123, "explanation": "Because you loved ...", "anchor": "Heat"}}]"""

    chat = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.6,
        seed=seed,
    )
    text = chat.choices[0].message.content.strip()
    text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1:
        return None
    picks = json.loads(text[start:end + 1])
    valid_ids = {c["tmdb_id"] for c in candidates}
    out: List[dict] = []
    seen: Set[int] = set()
    for p in picks:
        if isinstance(p, dict) and p.get("tmdb_id") in valid_ids and p["tmdb_id"] not in seen:
            seen.add(p["tmdb_id"])
            out.append({
                "tmdb_id": p["tmdb_id"],
                "explanation": str(p.get("explanation", "")),
                "anchor": p.get("anchor") if isinstance(p.get("anchor"), str) else None,
            })
    return out or None


def _template_reason(cand: dict, profile: dict) -> str:
    """Fallback explanation when the LLM is unavailable."""
    top = sorted(profile["loved"], key=lambda r: r.rating, reverse=True)
    overlap = next((r for r in top
                    if set(json.loads(r.genres) if r.genres else []) & set(cand["genres"])), None)
    if overlap:
        return f'Shares the {", ".join(cand["genres"][:2])} vibe of "{overlap.title}", which you rated {int(overlap.rating)}★.'
    return f'A highly-rated {", ".join(cand["genres"][:2]) or "pick"} ({cand["vote_average"]}★) that matches your taste.'


# ── Route ────────────────────────────────────────────────────────────────────

@router.get("/")
async def get_recommendations(
    refresh: int = Query(0, description="Bump to force a fresh, different set"),
    genre: Optional[str] = Query(None, description="Genre name for taste×genre mode"),
    mood: Optional[str] = Query(None, description="One of: " + ", ".join(sorted(MOODS))),
    providers: Optional[str] = Query(None, description="Comma-separated watch-provider ids — only recommend movies streamable on these services (US)"),
    db: Session = Depends(get_db),
):
    ratings = db.query(Rating).all()
    if not ratings:
        return {"recommendations": [], "message": "Rate some movies first to get recommendations!", "source": "none"}

    tmdb_key = os.getenv("TMDB_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")
    if not tmdb_key:
        return {"recommendations": [], "message": "TMDB not configured.", "source": "error"}

    watchlist = db.query(WatchlistItem).all()
    feedback = db.query(RecFeedback).all()
    not_interested_ids = {f.tmdb_id for f in feedback if f.action == "not_interested"}
    not_interested_titles = [f.title for f in feedback
                             if f.action == "not_interested" and f.title][-5:]
    shown_cutoff = datetime.utcnow() - timedelta(days=3)
    recently_shown = {f.tmdb_id for f in feedback
                      if f.action == "shown" and f.created_at and f.created_at >= shown_cutoff}

    genre_id = GENRE_NAME_TO_ID.get(genre) if genre else None
    mood_spec = MOODS.get(mood) if mood else None
    if genre_id:
        mood_spec = None  # genre wins if both are sent

    # Stage 0 + 1: facets (cached in SQLite) → weighted profile
    facets = await _ensure_facets(db, tmdb_key, list(ratings) + [w for w in watchlist if not w.watched])
    profile = _build_profile(ratings, watchlist, facets)

    # Stage 2: taste analysis — cached on the ratings fingerprint, Groq only on change
    fp_base = hashlib.md5(
        json.dumps(sorted((r.tmdb_id, r.rating) for r in ratings)).encode()).hexdigest()
    analysis: dict = {}
    if groq_key:
        row = db.query(TasteAnalysis).filter(TasteAnalysis.fingerprint == fp_base).first()
        if row:
            try:
                analysis = json.loads(row.payload)
            except Exception:
                analysis = {}
        else:
            try:
                analysis = await asyncio.to_thread(_groq_taste_analysis, profile, groq_key) or {}
            except Exception as e:
                print(f"Taste analysis failed: {e}")
            if analysis:
                db.query(TasteAnalysis).delete()
                db.merge(TasteAnalysis(fingerprint=fp_base, payload=json.dumps(analysis)))
                db.commit()

    exclude = ({r.tmdb_id for r in ratings} | {w.tmdb_id for w in watchlist}
               | not_interested_ids)

    fingerprint = f"{fp_base}|{refresh}|{genre}|{mood}|{providers}|{len(not_interested_ids)}"
    now = time.time()
    if refresh == 0 and fingerprint in _cache:
        ts, cached = _cache[fingerprint]
        if now - ts < CACHE_TTL:
            return dict(cached, source="cached")

    # Stage 3: candidates
    seed = refresh * 7919 + 17
    candidates = await _candidate_pool_v2(profile, analysis, tmdb_key, exclude,
                                          recently_shown, seed, genre_id, mood_spec,
                                          providers)
    if not candidates:
        msg = ("No picks found on your selected streaming services — try adding more services or turning the filter off."
               if providers else "Rate a few more movies to unlock picks.")
        return {"recommendations": [], "message": msg, "source": "error"}

    mode_ask: Optional[str] = None
    if genre_id:
        mode_ask = (f"The user specifically wants a {genre} movie tonight. Every pick must be a "
                    f"{genre} (or strongly {genre}-leaning) film chosen for THEIR taste — "
                    f"not just any popular {genre}.")
    elif mood_spec:
        mode_ask = mood_spec["ask"]

    # Stage 4: rank & explain
    source = "tmdb"
    ranked = candidates
    picks_meta: Dict[int, dict] = {}
    if groq_key:
        try:
            picks = await asyncio.to_thread(_groq_rank_v2, profile, analysis, candidates,
                                            groq_key, seed, mode_ask, not_interested_titles)
            if picks:
                by_id = {c["tmdb_id"]: c for c in candidates}
                ranked = [by_id[p["tmdb_id"]] for p in picks if p["tmdb_id"] in by_id]
                picks_meta = {p["tmdb_id"]: p for p in picks}
                source = "ai"
        except Exception as e:
            print(f"Groq ranking failed, using TMDB order: {e}")

    out = []
    for c in ranked[:12]:
        item = {k: v for k, v in c.items() if k != "_score"}
        meta = picks_meta.get(c["tmdb_id"], {})
        item["explanation"] = meta.get("explanation") or _template_reason(c, profile)
        item["anchor"] = meta.get("anchor") or c.get("anchor")
        out.append(item)

    # Log what we served (3-day rotation penalty) and prune stale rows
    for item in out:
        db.add(RecFeedback(tmdb_id=item["tmdb_id"], title=item["title"], action="shown"))
    db.query(RecFeedback).filter(
        RecFeedback.action == "shown",
        RecFeedback.created_at < datetime.utcnow() - timedelta(days=14),
    ).delete()
    db.commit()

    taste_strip = {
        "keywords": profile["top_keywords"][:6],
        "people": [name for _pid, name, _role in profile["loved_people"]][:4],
        "genres": [GENRE_MAP[g] for g, _cnt in profile["loved_genres"].most_common(3)
                   if g in GENRE_MAP],
        "tone": analysis.get("tone", ""),
    }
    payload = {"recommendations": out, "source": source, "taste": taste_strip}
    if refresh == 0:
        _cache[fingerprint] = (now, payload)
    return payload

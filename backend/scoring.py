"""Deterministic hybrid scorer + product buckets + MMR diversity.

This REPLACES the LLM ranking. Given candidates (each already carrying a DNA vector,
themes, and metadata) it produces a reproducible score, sorts each into a product
bucket, and selects a diverse final set with hard caps (no director/genre/decade tunnels).
Pure functions — no network, unit-tested in test_scoring.py.
"""
import hashlib
from typing import Dict, List, Optional, Tuple

from backend.dna import AXES, dna_distance

# ── Score weights (tunable) ──
W_DNA       = 0.34
W_GENRE     = 0.16
W_DIRECTOR  = 0.10
W_ACTOR     = 0.08
W_THEME     = 0.14
W_FRESH     = 0.06
W_DISCOVERY = 0.12
W_POPPEN    = 0.10

GENRE_NORM   = 8.0
PEOPLE_NORM  = 6.0
THEME_NORM   = 4.0
QUALITY_FLOOR = 5.5     # candidates below this vote_average are dropped before selection

# ── Bucket serving mix (sums to 12) ──
BUCKETS = ["Safe Picks", "Hidden Gems", "Expand Your Taste",
           "Critically Acclaimed", "Underseen Favorites", "Wildcard"]
BUCKET_MIX = {
    "Safe Picks": 3, "Hidden Gems": 2, "Expand Your Taste": 2,
    "Critically Acclaimed": 2, "Underseen Favorites": 2, "Wildcard": 1,
}
# Diversity caps across the whole served set
CAP_DIRECTOR = 2
CAP_GENRE = 4
CAP_DECADE = 2


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _jitter(tmdb_id: int, seed: int) -> float:
    h = hashlib.md5(f"{tmdb_id}:{seed}".encode()).hexdigest()
    return (int(h[:6], 16) % 1000) / 1000.0 * 0.05  # ≤0.05, deterministic per (movie, seed)


def score_candidate(cand: dict, profile: dict, user_dna: Dict[str, float],
                    confidence: Dict[str, float], seed: int = 0) -> Tuple[float, dict]:
    """Returns (score, components). cand must carry: dna, themes, genre_ids, genres,
    vote_average, vote_count, directors([[id,name]]), top_cast([[id,name]]), year."""
    cdna = cand.get("dna") or {a: 0.0 for a in AXES}
    dna_sim = 1.0 - dna_distance(user_dna, cdna, confidence)

    gids = set(cand.get("genre_ids", []))
    loved_g = profile.get("loved_genres", {})
    disliked_g = set(profile.get("disliked_genres", {}))
    sum_loved = sum(loved_g.get(g, 0) for g in gids)
    disliked_hits = sum(1 for g in gids if g in disliked_g)
    genre_affinity = _clamp01(sum_loved / GENRE_NORM - 0.4 * disliked_hits)

    people = profile.get("people_scores", {})
    director_ids = [pid for pid, _n in cand.get("directors", [])]
    cast_ids = [pid for pid, _n in cand.get("top_cast", [])]
    director_affinity = _clamp01(max([people.get(p, 0) for p in director_ids] or [0]) / PEOPLE_NORM)
    actor_affinity = _clamp01(sum(people.get(p, 0) for p in cast_ids) / (PEOPLE_NORM + 2))

    top_kw = {k.lower() for k in profile.get("top_keywords", [])}
    avoid_kw = {k.lower() for k in profile.get("avoid_keywords", [])}
    cand_terms = {t.lower() for t in (cand.get("themes", []) or [])}
    cand_terms |= {k.lower() for k in (cand.get("keywords", []) or [])}
    theme_hits = len(cand_terms & top_kw)
    avoid_hits = len(cand_terms & avoid_kw)
    theme_affinity = _clamp01(theme_hits / THEME_NORM - 0.3 * avoid_hits)

    year = cand.get("year")
    freshness = _clamp01((year - 2000) / 26.0) if isinstance(year, int) else 0.3

    va = cand.get("vote_average", 0.0) or 0.0
    vc = cand.get("vote_count", 0) or 0
    discovery = _clamp01((va - 6.0) / 3.0) * _clamp01(1.0 - vc / 5000.0)
    pop_penalty = _clamp01(vc / 15000.0)

    # Thin profiles trust the personal signal less, lean on baseline quality/discovery.
    mean_conf = sum(confidence.get(a, 0.0) for a in AXES) / len(AXES)
    blend = 0.6 + 0.4 * mean_conf

    personal = (W_DNA * dna_sim + W_GENRE * genre_affinity + W_DIRECTOR * director_affinity
                + W_ACTOR * actor_affinity + W_THEME * theme_affinity)
    baseline = W_FRESH * freshness + W_DISCOVERY * discovery - W_POPPEN * pop_penalty
    score = blend * personal + baseline + _jitter(cand.get("tmdb_id", 0), seed)

    comps = {
        "dna_sim": round(dna_sim, 3), "genre_affinity": round(genre_affinity, 3),
        "director_affinity": round(director_affinity, 3), "actor_affinity": round(actor_affinity, 3),
        "theme_affinity": round(theme_affinity, 3), "freshness": round(freshness, 3),
        "discovery": round(discovery, 3), "pop_penalty": round(pop_penalty, 3),
        "diff_axes": _diff_axes(user_dna, cdna),
    }
    return score, comps


def _diff_axes(user_dna: Dict[str, float], cdna: Dict[str, float], thresh: float = 0.3) -> int:
    """How many axes meaningfully oppose the user's taste (the 'stretch' signal)."""
    n = 0
    for a in AXES:
        u, c = user_dna.get(a, 0.0), cdna.get(a, 0.0)
        if abs(u) >= thresh and abs(c) >= thresh and (u > 0) != (c > 0):
            n += 1
    return n


def assign_bucket(cand: dict, comps: dict) -> Tuple[str, str]:
    """Sort a scored candidate into its most distinctive product bucket + a short reason.
    Niche buckets win over Safe so each bucket actually fills."""
    va = cand.get("vote_average", 0.0) or 0.0
    vc = cand.get("vote_count", 0) or 0
    sim = comps["dna_sim"]
    diff = comps["diff_axes"]

    if cand.get("channel") == "wildcard":
        return "Wildcard", "A deliberate left-turn from your usual taste."
    if vc <= 600 and va >= 6.8:
        return "Underseen Favorites", f"A deep cut ({va}★, barely seen) that fits you."
    if va >= 7.0 and 150 <= vc <= 3000 and sim >= 0.5:
        return "Hidden Gems", f"Well-reviewed ({va}★) but under the radar."
    if va >= 7.6 and vc >= 1500:
        return "Critically Acclaimed", f"Broadly acclaimed ({va}★) and on your wavelength."
    if 0.45 <= sim <= 0.72 and diff >= 1:
        return "Expand Your Taste", "Adjacent to your taste, with a new wrinkle."
    if sim >= 0.65:
        return "Safe Picks", "A confident match for what you love."
    return "Safe Picks", "In line with your taste."


def _primary_genre(cand: dict) -> Optional[str]:
    g = cand.get("genres") or []
    return g[0] if g else None


def _director_id(cand: dict) -> Optional[int]:
    d = cand.get("directors") or []
    return d[0][0] if d else None


def _decade(cand: dict) -> Optional[int]:
    y = cand.get("year")
    return (y // 10) * 10 if isinstance(y, int) else None


def select_with_buckets_mmr(scored: List[dict], n: int = 12) -> List[dict]:
    """scored: candidates with .score and .bucket set. Returns up to n picks honoring the
    bucket mix AND hard diversity caps (≤2 same director, ≤4 same genre, ≤2 same decade).
    Underfilled buckets redistribute their slots to the global best-remaining."""
    by_bucket: Dict[str, List[dict]] = {b: [] for b in BUCKETS}
    for c in scored:
        by_bucket.setdefault(c.get("bucket", "Safe Picks"), []).append(c)
    for lst in by_bucket.values():
        lst.sort(key=lambda x: x["score"], reverse=True)

    dir_count: Dict[int, int] = {}
    gen_count: Dict[str, int] = {}
    dec_count: Dict[int, int] = {}
    chosen_ids = set()
    selected: List[dict] = []

    def violates(c: dict) -> bool:
        d, g, dec = _director_id(c), _primary_genre(c), _decade(c)
        if d is not None and dir_count.get(d, 0) >= CAP_DIRECTOR:
            return True
        if g is not None and gen_count.get(g, 0) >= CAP_GENRE:
            return True
        if dec is not None and dec_count.get(dec, 0) >= CAP_DECADE:
            return True
        return False

    def take(c: dict):
        d, g, dec = _director_id(c), _primary_genre(c), _decade(c)
        if d is not None:
            dir_count[d] = dir_count.get(d, 0) + 1
        if g is not None:
            gen_count[g] = gen_count.get(g, 0) + 1
        if dec is not None:
            dec_count[dec] = dec_count.get(dec, 0) + 1
        chosen_ids.add(c["tmdb_id"])
        selected.append(c)

    # Pass 1: honor the bucket mix.
    for bucket, want in BUCKET_MIX.items():
        got = 0
        for c in by_bucket.get(bucket, []):
            if got >= want or len(selected) >= n:
                break
            if c["tmdb_id"] in chosen_ids or violates(c):
                continue
            take(c)
            got += 1

    # Pass 2: fill any remaining slots from the global best-remaining (caps still apply).
    if len(selected) < n:
        rest = sorted(
            (c for c in scored if c["tmdb_id"] not in chosen_ids),
            key=lambda x: x["score"], reverse=True,
        )
        for c in rest:
            if len(selected) >= n:
                break
            if violates(c):
                continue
            take(c)

    # Pass 3: last resort — if caps starved us, relax them to hit n.
    if len(selected) < n:
        for c in sorted(scored, key=lambda x: x["score"], reverse=True):
            if len(selected) >= n:
                break
            if c["tmdb_id"] not in chosen_ids:
                chosen_ids.add(c["tmdb_id"])
                selected.append(c)

    selected.sort(key=lambda x: x["score"], reverse=True)
    return selected[:n]

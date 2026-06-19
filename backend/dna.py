"""Taste DNA — 10 bipolar axes that capture *why* a user likes films, not just which.

Each axis is a float in [-1, 1]; +1 is the second pole named below. Movies get a vector
either deterministically (proxy_dna, instant + free) or from the LLM (llm_score_dna, richer).
The user profile is a confidence-weighted aggregate of their rated movies' vectors.
"""
import json
from typing import Dict, List, Optional, Tuple

from groq import Groq

# Bump when the axes, the proxy heuristics, or the LLM prompt change — every cached
# movie_dna row with a different version is treated as stale and recomputed (M6).
DNA_MODEL_VERSION = "1"

# axis -> (negative pole, positive pole). Order is canonical; keep it stable.
AXES: List[str] = [
    "pace", "focus", "tone", "mode", "realism",
    "texture", "scale", "concept", "humor", "complexity",
]
AXIS_POLES: Dict[str, Tuple[str, str]] = {
    "pace":       ("slow-burn", "fast-paced"),
    "focus":      ("plot-driven", "character-driven"),
    "tone":       ("dark", "feel-good"),
    "mode":       ("cerebral", "emotional"),
    "realism":    ("fantastical", "realistic"),
    "texture":    ("action-driven", "dialogue-driven"),
    "scale":      ("blockbuster", "indie"),
    "concept":    ("grounded", "high-concept"),
    "humor":      ("serious", "funny"),
    "complexity": ("accessible", "complex"),
}


def _clamp(v: float) -> float:
    return max(-1.0, min(1.0, v))


def zero_vector() -> Dict[str, float]:
    return {a: 0.0 for a in AXES}


# ── Deterministic proxy (instant, free — used until an LLM vector is cached) ──

# genre name -> {axis: nudge}
_GENRE_NUDGE: Dict[str, Dict[str, float]] = {
    "Action":          {"pace": 0.5, "texture": -0.6, "concept": -0.1, "mode": -0.1},
    "Adventure":       {"pace": 0.3, "texture": -0.3, "tone": 0.1},
    "Animation":       {"realism": -0.6, "tone": 0.2, "concept": 0.2},
    "Comedy":          {"humor": 0.7, "tone": 0.4, "complexity": -0.2},
    "Crime":           {"tone": -0.4, "texture": 0.1, "complexity": 0.1},
    "Documentary":     {"realism": 0.8, "mode": -0.4, "texture": 0.4, "complexity": 0.2},
    "Drama":           {"focus": 0.5, "mode": 0.3, "texture": 0.4, "pace": -0.3, "realism": 0.3},
    "Family":          {"tone": 0.6, "complexity": -0.4, "humor": 0.3},
    "Fantasy":         {"realism": -0.7, "concept": 0.5},
    "History":         {"realism": 0.5, "pace": -0.2, "texture": 0.2},
    "Horror":          {"tone": -0.7, "pace": 0.2, "mode": 0.1},
    "Music":           {"mode": 0.3, "tone": 0.2},
    "Mystery":         {"complexity": 0.5, "pace": -0.2, "focus": 0.1, "concept": 0.2},
    "Romance":         {"mode": 0.6, "focus": 0.4, "tone": 0.3, "texture": 0.3},
    "Science Fiction": {"realism": -0.6, "concept": 0.7, "complexity": 0.3},
    "Thriller":        {"pace": 0.4, "tone": -0.3, "complexity": 0.2},
    "War":             {"tone": -0.5, "realism": 0.3, "texture": -0.2},
    "Western":         {"pace": -0.1, "realism": 0.2},
    "TV Movie":        {"scale": 0.3},
}

# keyword substring -> {axis: nudge}
_KEYWORD_NUDGE: List[Tuple[str, Dict[str, float]]] = [
    ("slow burn",       {"pace": -0.6}),
    ("slow-burn",       {"pace": -0.6}),
    ("fast paced",      {"pace": 0.5}),
    ("time loop",       {"complexity": 0.5, "concept": 0.4}),
    ("nonlinear",       {"complexity": 0.5}),
    ("mind bending",    {"complexity": 0.5, "concept": 0.3}),
    ("psychological",   {"complexity": 0.4, "mode": 0.1}),
    ("twist ending",    {"complexity": 0.3}),
    ("dystopia",        {"concept": 0.5, "realism": -0.4, "tone": -0.3}),
    ("post-apocalyptic", {"concept": 0.4, "realism": -0.3, "tone": -0.3}),
    ("space opera",     {"concept": 0.6, "realism": -0.5}),
    ("based on true story", {"realism": 0.6}),
    ("biography",       {"realism": 0.6, "focus": 0.3}),
    ("feel good",       {"tone": 0.6, "mode": 0.3}),
    ("heartwarming",    {"tone": 0.5, "mode": 0.4}),
    ("friendship",      {"mode": 0.3, "tone": 0.3}),
    ("found family",    {"mode": 0.4, "tone": 0.4, "focus": 0.3}),
    ("coming of age",   {"focus": 0.4, "mode": 0.3}),
    ("bleak",           {"tone": -0.6}),
    ("nihilism",        {"tone": -0.5, "complexity": 0.2}),
    ("satire",          {"humor": 0.4, "complexity": 0.2}),
    ("dark comedy",     {"humor": 0.4, "tone": -0.2}),
    ("car chase",       {"texture": -0.4, "pace": 0.3}),
    ("violence",        {"texture": -0.3, "tone": -0.2}),
    ("gore",            {"texture": -0.4, "tone": -0.4}),
    ("indie",           {"scale": 0.6}),
    ("independent film", {"scale": 0.6}),
]


def proxy_dna(facets: Optional[dict], genres: List[str],
              vote_average: float = 0.0, vote_count: int = 0,
              popularity: float = 0.0) -> Dict[str, float]:
    """Rough vector from signals already in movie_facets/TMDB. Deterministic, instant."""
    v = zero_vector()
    facets = facets or {}

    for g in genres:
        for ax, nudge in _GENRE_NUDGE.get(g, {}).items():
            v[ax] += nudge

    kws = " ".join(k.lower() for k in facets.get("keywords", []))
    for needle, nudge in _KEYWORD_NUDGE:
        if needle in kws:
            for ax, n in nudge.items():
                v[ax] += n

    runtime = facets.get("runtime")
    if isinstance(runtime, int) and runtime > 0:
        if runtime < 90:
            v["pace"] += 0.2; v["complexity"] -= 0.1
        elif runtime > 150:
            v["pace"] -= 0.3; v["complexity"] += 0.2

    if facets.get("original_language") and facets["original_language"] != "en":
        v["scale"] += 0.3; v["realism"] += 0.1

    # Popularity → blockbuster/indie axis (scale: +1 indie, -1 blockbuster)
    if vote_count >= 5000 or popularity >= 200:
        v["scale"] -= 0.5
    elif 0 < vote_count <= 500:
        v["scale"] += 0.4

    return {a: _clamp(x) for a, x in v.items()}


# ── LLM scorer (richer; cached forever in movie_dna once computed) ──

def llm_score_dna(movie: dict, groq_key: str) -> Optional[dict]:
    """One Groq call → {axes:{...}, themes:[...]}. movie needs title/year/genres/overview/keywords."""
    client = Groq(api_key=groq_key)
    axis_doc = "\n".join(
        f'  "{a}": float in [-1,1]  ({neg} = -1 … {pos} = +1)'
        for a, (neg, pos) in AXIS_POLES.items()
    )
    prompt = f"""You are a film analyst. Score this movie on 10 bipolar taste axes and extract its themes.

MOVIE: {movie.get('title')} ({movie.get('year') or '—'})
GENRES: {', '.join(movie.get('genres', []))}
KEYWORDS: {', '.join(movie.get('keywords', [])[:15])}
OVERVIEW: {(movie.get('overview') or '')[:400]}

Respond ONLY with valid JSON (no markdown, no code fences):
{{"axes": {{
{axis_doc}
}},
 "themes": ["3-6 short thematic tags, lowercase, e.g. 'grief', 'redemption', 'identity'"]}}

Be decisive — use the full [-1,1] range. A film can be near 0 on an axis if genuinely balanced."""

    chat = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    text = chat.choices[0].message.content.strip()
    text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    data = json.loads(text[start:end + 1])
    if not isinstance(data, dict):
        return None
    raw_axes = data.get("axes", {}) if isinstance(data.get("axes"), dict) else {}
    axes = zero_vector()
    for a in AXES:
        try:
            axes[a] = _clamp(float(raw_axes.get(a, 0.0)))
        except (TypeError, ValueError):
            axes[a] = 0.0
    themes = [str(t).lower() for t in data.get("themes", []) if isinstance(t, str)][:6]
    return {"axes": axes, "themes": themes}


# ── Aggregation (deterministic): rated movies → user DNA + per-axis confidence ──

def aggregate_profile_dna(
    contributions: List[Tuple[float, Dict[str, float]]]
) -> Tuple[Dict[str, float], Dict[str, float]]:
    """contributions: list of (weight, movie_dna). weight = rating-3 (5★=+2 … 1★=-2).
    Returns (user_dna, confidence). Disliked movies push the profile the opposite way."""
    dna = zero_vector()
    conf = zero_vector()
    weighted = [(w, d) for w, d in contributions if w != 0 and d]
    if not weighted:
        return dna, conf

    total_w = sum(abs(w) for w, _ in weighted)
    for a in AXES:
        signed = sum(w * d.get(a, 0.0) for w, d in weighted)        # direction + magnitude
        mass = sum(abs(w * d.get(a, 0.0)) for w, d in weighted)     # total movement on axis
        dna[a] = _clamp(signed / total_w) if total_w else 0.0
        agreement = (abs(signed) / mass) if mass > 1e-9 else 0.0    # 1 = all push same way
        data_factor = min(1.0, total_w / 6.0)                       # needs a few strong signals
        conf[a] = round(max(0.0, min(1.0, data_factor * agreement)), 3)
    return {a: round(x, 3) for a, x in dna.items()}, conf


# ── Distance + word summary (used by scorer + explanations + taste strip) ──

def dna_distance(a: Dict[str, float], b: Dict[str, float],
                 weights: Optional[Dict[str, float]] = None) -> float:
    """Confidence-weighted normalized distance in [0,1]. 0 = identical, 1 = opposite."""
    w = weights or {ax: 1.0 for ax in AXES}
    wsum = sum(w.get(ax, 0.0) for ax in AXES)
    if wsum <= 1e-9:
        w = {ax: 1.0 for ax in AXES}; wsum = float(len(AXES))
    sq = sum(w.get(ax, 0.0) * (a.get(ax, 0.0) - b.get(ax, 0.0)) ** 2 for ax in AXES)
    # each squared diff ∈ [0,4]; normalize the weighted mean to [0,1]
    return min(1.0, (sq / wsum) / 4.0)


def axes_to_words(dna: Dict[str, float], confidence: Dict[str, float],
                  limit: int = 4, conf_floor: float = 0.2, val_floor: float = 0.22) -> List[str]:
    """Top distinctive traits as human words, strongest first."""
    scored = []
    for a in AXES:
        val, conf = dna.get(a, 0.0), confidence.get(a, 0.0)
        if conf >= conf_floor and abs(val) >= val_floor:
            word = AXIS_POLES[a][1] if val > 0 else AXIS_POLES[a][0]
            scored.append((conf * abs(val), word))
    scored.sort(reverse=True)
    return [w for _s, w in scored[:limit]]

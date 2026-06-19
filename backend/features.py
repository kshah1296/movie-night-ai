"""Feature extraction + learned-model application (S1).

ONE place that turns a candidate into features, used by both serving (`scoring.score_candidate`)
and training (`train.py`) — so there is zero train/serve skew. The learned ranker (a standardized
linear model) is stored in the `learned_models` table; `load_active_model()` reads the active one and
`apply_model()` scores a feature dict with it. When no model exists, the scorer falls back to the
hand-tuned weights.
"""
import json
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from backend.dna import AXES, dna_distance
from backend.models import LearnedModel

# normalization constants (kept here so train + serve agree)
GENRE_NORM = 8.0
PEOPLE_NORM = 6.0
THEME_NORM = 4.0

# The model trains on exactly these features, in this order. `genre_affinity_norm` is the
# de-saturated genre (M4) and `dna_is_proxy` is the M3 signal — both failed as hand-set knobs
# but are useful INPUTS the model can weight (and sign) correctly.
FEATURE_NAMES: List[str] = [
    "dna_sim", "genre_affinity", "genre_affinity_norm", "director_affinity",
    "actor_affinity", "theme_affinity", "freshness", "discovery", "pop_penalty", "dna_is_proxy",
]


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def extract_features(cand: dict, profile: dict, user_dna: Dict[str, float],
                     confidence: Dict[str, float]) -> Dict[str, float]:
    cdna = cand.get("dna") or {a: 0.0 for a in AXES}
    dna_sim = 1.0 - dna_distance(user_dna, cdna, confidence)

    gids = set(cand.get("genre_ids", []))
    loved_g = profile.get("loved_genres", {})
    disliked_g = set(profile.get("disliked_genres", {}))
    sum_loved = sum(loved_g.get(g, 0) for g in gids)
    disliked_hits = sum(1 for g in gids if g in disliked_g)
    genre_affinity = _clamp01(sum_loved / GENRE_NORM - 0.4 * disliked_hits)
    # de-saturated: normalized by the user's own top genre weight (varies for heavy users)
    max_g = max(loved_g.values()) if loved_g else 0
    best_g = max((loved_g.get(g, 0) for g in gids), default=0)
    genre_affinity_norm = _clamp01((best_g / max_g if max_g > 0 else 0.0) - 0.4 * disliked_hits)

    people = profile.get("people_scores", {})
    director_ids = [pid for pid, _n in cand.get("directors", [])]
    cast_ids = [pid for pid, _n in cand.get("top_cast", [])]
    director_affinity = _clamp01(max([people.get(p, 0) for p in director_ids] or [0]) / PEOPLE_NORM)
    actor_affinity = _clamp01(sum(people.get(p, 0) for p in cast_ids) / (PEOPLE_NORM + 2))

    top_kw = {k.lower() for k in profile.get("top_keywords", [])}
    avoid_kw = {k.lower() for k in profile.get("avoid_keywords", [])}
    cand_terms = {t.lower() for t in (cand.get("themes", []) or [])}
    cand_terms |= {k.lower() for k in (cand.get("keywords", []) or [])}
    theme_affinity = _clamp01(len(cand_terms & top_kw) / THEME_NORM - 0.3 * len(cand_terms & avoid_kw))

    year = cand.get("year")
    freshness = _clamp01((year - 2000) / 26.0) if isinstance(year, int) else 0.3

    va = cand.get("vote_average", 0.0) or 0.0
    vc = cand.get("vote_count", 0) or 0
    discovery = _clamp01((va - 6.0) / 3.0) * _clamp01(1.0 - vc / 5000.0)
    pop_penalty = _clamp01(vc / 15000.0)

    # 1 unless the DNA vector came from the LLM (proxy / proxy-transient / missing all count as proxy)
    dna_is_proxy = 0.0 if cand.get("dna_source") == "llm" else 1.0

    return {
        "dna_sim": dna_sim, "genre_affinity": genre_affinity, "genre_affinity_norm": genre_affinity_norm,
        "director_affinity": director_affinity, "actor_affinity": actor_affinity,
        "theme_affinity": theme_affinity, "freshness": freshness, "discovery": discovery,
        "pop_penalty": pop_penalty, "dna_is_proxy": dna_is_proxy,
    }


def apply_model(model: dict, feats: Dict[str, float]) -> float:
    """Standardized linear score: intercept + Σ coef·(x−mean)/std."""
    score = model["intercept"]
    for i, name in enumerate(model["features"]):
        std = model["std"][i] or 1.0
        z = (feats.get(name, 0.0) - model["mean"][i]) / std
        score += model["coef"][i] * z
    return score


def load_active_model(db: Session) -> Optional[dict]:
    """The active learned model as a plain dict, or None (→ hand-tuned fallback)."""
    row = (db.query(LearnedModel)
           .filter(LearnedModel.active == True)  # noqa: E712
           .order_by(LearnedModel.created_at.desc()).first())
    if row is None:
        return None
    try:
        return {
            "features": json.loads(row.features),
            "coef": json.loads(row.coef),
            "mean": json.loads(row.mean),
            "std": json.loads(row.std),
            "intercept": row.intercept,
            "model_version": row.model_version,
        }
    except Exception:
        return None

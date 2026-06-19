"""Offline evaluation harness (M5) — the measuring stick for the recommender.

Time-splits the user's ratings (train on the older ones, hold out the most-recent), rebuilds the
taste profile + Taste-DNA from TRAIN ONLY, scores the held-out movies with the deterministic
`scoring.score_candidate`, and reports whether that score:
  • predicts the actual rating        → Pearson / Spearman correlation
  • ranks high-rated above low-rated   → NDCG@k
  • is calibratable to stars           → calibrated RMSE (in-sample linear fit)

This is the gate for every later weight/feature change (M1, M3, M4, S1): run it before and
after, and keep the change only if the metrics improve.

Run:   venv/bin/python -m backend.eval [--test-frac 0.3] [--k 12] [--seed 42]
Or:    GET /analytics/eval?test_frac=0.3&k=12

Notes / honest caveats:
- Uses only cached data (movie_dna, movie_facets) — no network, fully deterministic.
- `vote_average`/`vote_count` aren't stored on Rating, so they're held at neutral constants;
  that's fine — it washes the popularity/discovery baseline out and isolates the PERSONAL
  signal (DNA, genre, theme, people), which is exactly what we're evaluating.
- Held-out test sets are small per user, so the calibrated RMSE is in-sample-optimistic;
  trust Pearson/Spearman/NDCG more than the absolute RMSE.
"""
import argparse
import json
import math
from typing import Dict, List, Optional

from backend.database import SessionLocal
from backend.models import MovieDNA, MovieFacets, Rating
from backend import dna as dna_mod
from backend import scoring
from backend.routers.recommendations import _build_profile, GENRE_NAME_TO_ID

# Held at neutral constants (not stored on Rating) — see module docstring.
_EVAL_VOTE_AVERAGE = 7.0
_EVAL_VOTE_COUNT = 1000


# ── metric helpers (pure, unit-tested) ──

def _pearson(xs: List[float], ys: List[float]) -> Optional[float]:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def _avg_ranks(xs: List[float]) -> List[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2.0
        for t in range(i, j + 1):
            ranks[order[t]] = avg
        i = j + 1
    return ranks


def _spearman(xs: List[float], ys: List[float]) -> Optional[float]:
    if len(xs) < 3:
        return None
    return _pearson(_avg_ranks(xs), _avg_ranks(ys))


def _dcg(rels: List[float]) -> float:
    return sum(rel / math.log2(i + 2) for i, rel in enumerate(rels))


def ndcg_at_k(rels_in_ranked_order: List[float], k: int) -> Optional[float]:
    """rels_in_ranked_order: relevance grades ordered by the model's predicted score."""
    k = min(k, len(rels_in_ranked_order))
    if k == 0:
        return None
    dcg = _dcg(rels_in_ranked_order[:k])
    ideal = _dcg(sorted(rels_in_ranked_order, reverse=True)[:k])
    return (dcg / ideal) if ideal > 0 else None


def calibrated_rmse(preds: List[float], actuals: List[float]) -> Optional[float]:
    """RMSE in star units after a least-squares linear map score→rating (in-sample)."""
    n = len(preds)
    if n < 2:
        return None
    mx, my = sum(preds) / n, sum(actuals) / n
    sxx = sum((p - mx) ** 2 for p in preds)
    if sxx <= 1e-12:
        return None
    sxy = sum((preds[i] - mx) * (actuals[i] - my) for i in range(n))
    slope = sxy / sxx
    intercept = my - slope * mx
    se = sum((actuals[i] - (slope * preds[i] + intercept)) ** 2 for i in range(n))
    return math.sqrt(se / n)


# ── data loading (cached only — no network) ──

def _load_facets(db, ids: List[int]) -> Dict[int, dict]:
    out: Dict[int, dict] = {}
    if not ids:
        return out
    for row in db.query(MovieFacets).filter(MovieFacets.tmdb_id.in_(ids)).all():
        out[row.tmdb_id] = {
            "keywords": json.loads(row.keywords or "[]"),
            "directors": json.loads(row.directors or "[]"),
            "top_cast": json.loads(row.top_cast or "[]"),
            "original_language": row.original_language,
            "runtime": row.runtime, "year": row.year,
        }
    return out


def _load_dna(db, ids: List[int]) -> Dict[int, dict]:
    out: Dict[int, dict] = {}
    if not ids:
        return out
    for row in db.query(MovieDNA).filter(MovieDNA.tmdb_id.in_(ids)).all():
        try:
            axes = json.loads(row.axes or "{}")
            themes = json.loads(row.themes or "[]")
        except Exception:
            axes, themes = {}, []
        out[row.tmdb_id] = {"axes": {a: float(axes.get(a, 0.0)) for a in dna_mod.AXES},
                            "themes": themes}
    return out


def _rating_to_candidate(r: Rating, facets: Dict[int, dict], dnas: Dict[int, dict]) -> dict:
    try:
        names = json.loads(r.genres) if r.genres else []
    except Exception:
        names = []
    f = facets.get(r.tmdb_id, {})
    d = dnas.get(r.tmdb_id, {})
    return {
        "tmdb_id": r.tmdb_id, "year": r.year,
        "genres": names,
        "genre_ids": [GENRE_NAME_TO_ID[n] for n in names if n in GENRE_NAME_TO_ID],
        "vote_average": _EVAL_VOTE_AVERAGE, "vote_count": _EVAL_VOTE_COUNT,
        "directors": f.get("directors", []), "top_cast": f.get("top_cast", []),
        "keywords": f.get("keywords", []),
        "themes": d.get("themes", []), "dna": d.get("axes", {}),
        "channel": "eval",
    }


# ── the harness ──

def split_ratings(rows: list, test_frac: float = 0.3,
                  min_train: int = 8, min_test: int = 4):
    """Deterministic time-split: older ratings train, the most-recent hold out.
    Returns (train, test); both empty if there aren't enough ratings."""
    n = len(rows)
    if n < min_train + min_test:
        return [], []
    split = max(min_train, int(round(n * (1 - test_frac))))
    split = min(split, n - min_test)
    return rows[:split], rows[split:]


def run_eval(db, test_frac: float = 0.3, k: int = 12,
             min_train: int = 8, min_test: int = 4,
             model: Optional[dict] = None) -> dict:
    rows = db.query(Rating).order_by(Rating.created_at, Rating.id).all()
    n = len(rows)
    if n < min_train + min_test:
        return {"error": "not enough ratings for a time-split",
                "n_ratings": n, "needed": min_train + min_test}

    train, test = split_ratings(rows, test_frac, min_train, min_test)

    ids = [r.tmdb_id for r in rows]
    facets = _load_facets(db, ids)
    dnas = _load_dna(db, ids)

    # Build the profile + user DNA from TRAIN only.
    profile = _build_profile(train, [], facets)
    contributions = [(int(r.rating) - 3, dnas.get(r.tmdb_id, {}).get("axes", {})) for r in train]
    user_dna, confidence = dna_mod.aggregate_profile_dna(contributions)

    # Score each held-out movie with the trained profile.
    preds: List[float] = []
    actuals: List[float] = []
    for r in test:
        cand = _rating_to_candidate(r, facets, dnas)
        score, _comps = scoring.score_candidate(cand, profile, user_dna, confidence, model=model)
        preds.append(score)
        actuals.append(float(r.rating))

    # NDCG: relevance = max(0, rating-2)  (3★=1, 4★=2, 5★=3, ≤2★=0), ranked by predicted score.
    order = sorted(range(len(test)), key=lambda i: preds[i], reverse=True)
    rels_ranked = [max(0.0, actuals[i] - 2.0) for i in order]

    dna_coverage = sum(1 for r in test if r.tmdb_id in dnas) / len(test)

    return {
        "test_frac": test_frac,
        "n_ratings": n, "n_train": len(train), "n_test": len(test),
        "pearson_r": _round(_pearson(preds, actuals)),
        "spearman_r": _round(_spearman(preds, actuals)),
        f"ndcg_at_{k}": _round(ndcg_at_k(rels_ranked, k)),
        "calibrated_rmse_stars": _round(calibrated_rmse(preds, actuals)),
        "test_dna_coverage": round(dna_coverage, 3),
        "note": "Pearson/Spearman/NDCG are the trustworthy signals; RMSE is in-sample-optimistic.",
    }


def _round(v: Optional[float]) -> Optional[float]:
    return round(v, 4) if v is not None else None


def main() -> None:
    ap = argparse.ArgumentParser(description="Offline recommender eval (M5)")
    ap.add_argument("--test-frac", type=float, default=0.3)
    ap.add_argument("--k", type=int, default=12)
    ap.add_argument("--baseline", action="store_true",
                    help="force the hand-tuned scorer (ignore the active learned model)")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        # Reflect what's actually serving (the active learned model), unless --baseline.
        from backend.features import load_active_model
        model = None if args.baseline else load_active_model(db)
        report = run_eval(db, test_frac=args.test_frac, k=args.k, model=model)
        report["scorer"] = "hand-tuned" if model is None else f"learned:{model.get('model_version')}"
    finally:
        db.close()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

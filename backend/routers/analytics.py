"""Recommendation-quality metrics computed from the RecEvent stream + ratings/watchlist.
Backend-only; curl GET /analytics/ (optionally ?days=N). No UI."""
import json
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import MovieDNA, Rating, RecEvent, WatchlistItem
from backend import dna as dna_mod

router = APIRouter()


def _pearson(xs: List[float], ys: List[float]) -> Optional[float]:
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx <= 0 or vy <= 0:
        return None
    return cov / ((vx * vy) ** 0.5)


def _rate(num: int, den: int) -> Optional[float]:
    return round(num / den, 3) if den else None


@router.get("/")
def analytics(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    since = datetime.utcnow() - timedelta(days=days)
    events = db.query(RecEvent).filter(RecEvent.created_at >= since).all()
    impressions = [e for e in events if e.event_type == "impression"]
    imp_ids = {e.tmdb_id for e in impressions}
    n_imp = len(impressions)
    n_distinct = len(imp_ids)

    def count(t: str) -> int:
        return sum(1 for e in events if e.event_type == t)

    clicks, trailers, shares, skips = count("click"), count("trailer"), count("share"), count("skip")

    ratings = {r.tmdb_id: r.rating for r in db.query(Rating).all()}
    wl = {w.tmdb_id: w for w in db.query(WatchlistItem).all()}

    def actual_rating(mid: int) -> Optional[float]:
        if mid in ratings:
            return float(ratings[mid])
        w = wl.get(mid)
        if w and w.post_watch_rating:
            return float(w.post_watch_rating)
        return None

    watchlisted_shown = sum(1 for i in imp_ids if i in wl)
    accepted = sum(1 for i in imp_ids if i in wl or (actual_rating(i) or 0) >= 4)

    # Rating-prediction: predicted_score vs the rating actually given (one row per movie).
    xs: List[float] = []
    ys: List[float] = []
    seen = set()
    for e in sorted(impressions, key=lambda x: x.id, reverse=True):
        if e.predicted_score is None or e.tmdb_id in seen:
            continue
        a = actual_rating(e.tmdb_id)
        if a is not None:
            seen.add(e.tmdb_id)
            xs.append(float(e.predicted_score))
            ys.append(a)
    pred_corr = _pearson(xs, ys)

    # Novelty: 1 − how mainstream the served picks are (by vote_count).
    vcs = [e.vote_count for e in impressions if e.vote_count is not None]
    novelty = (sum(1 - min(1.0, v / 20000.0) for v in vcs) / len(vcs)) if vcs else None

    # Diversity: avg pairwise Taste-DNA distance over the most recent served batch (≤12).
    last, seen_b = [], set()
    for e in sorted(impressions, key=lambda x: x.id, reverse=True):
        if e.tmdb_id in seen_b:
            continue
        seen_b.add(e.tmdb_id)
        last.append(e)
        if len(last) >= 12:
            break
    axes_by_id = {}
    if last:
        for row in db.query(MovieDNA).filter(MovieDNA.tmdb_id.in_([e.tmdb_id for e in last])).all():
            try:
                axes_by_id[row.tmdb_id] = json.loads(row.axes or "{}")
            except Exception:
                pass
    vecs = [axes_by_id[e.tmdb_id] for e in last if e.tmdb_id in axes_by_id]
    diversity = None
    if len(vecs) >= 2:
        dists = [dna_mod.dna_distance(vecs[i], vecs[j])
                 for i in range(len(vecs)) for j in range(i + 1, len(vecs))]
        diversity = round(sum(dists) / len(dists), 3)

    return {
        "window_days": days,
        "impressions": n_imp,
        "impressions_distinct": n_distinct,
        "engagement": {"clicks": clicks, "trailers": trailers, "shares": shares, "skips": skips},
        "ctr": _rate(clicks, n_imp),
        "watchlist_conversion": _rate(watchlisted_shown, n_distinct),
        "acceptance_rate": _rate(accepted, n_distinct),
        "rating_prediction": {
            "pearson_r": round(pred_corr, 3) if pred_corr is not None else None,
            "n": len(xs),
        },
        "novelty_score": round(novelty, 3) if novelty is not None else None,
        "diversity_score": diversity,
        "last_batch_distinct_buckets": len({e.bucket for e in last if e.bucket}),
    }

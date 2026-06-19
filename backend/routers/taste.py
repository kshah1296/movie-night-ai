"""User-facing Taste-DNA profile (UX18) — the persisted `taste_profile` row turned into a
radar-ready payload: the 10 bipolar axes with their pole labels + per-axis confidence, plus the
top genres/people/themes that shape the picks. Read-only; the profile itself is (re)built by the
recommendations engine, so this just surfaces what's already computed."""
import json
from typing import Dict, List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import MovieFacets, Rating, TasteProfile
from backend.dna import AXES, AXIS_POLES, axes_to_words

router = APIRouter()


def _people_names(db: Session) -> Dict[int, str]:
    """person_id -> name, harvested from cached facets (directors + top cast)."""
    names: Dict[int, str] = {}
    for row in db.query(MovieFacets.directors, MovieFacets.top_cast).all():
        for blob in (row[0], row[1]):
            try:
                for pid, name in json.loads(blob or "[]"):
                    names[int(pid)] = name
            except Exception:
                continue
    return names


@router.get("/")
def taste(db: Session = Depends(get_db)):
    """The user's Taste DNA: per-axis lean + confidence, and the genres/people/themes behind it."""
    n_ratings = db.query(Rating).count()
    profile = db.query(TasteProfile).filter(TasteProfile.user_id == "local").first()

    if profile is None:
        return {"has_profile": False, "n_ratings": n_ratings,
                "axes": [], "traits": [], "genres": [], "people": [], "keywords": [],
                "mean_confidence": 0.0, "updated_at": None}

    def _load(blob):
        try:
            return json.loads(blob or "{}")
        except Exception:
            return {}

    dna = _load(profile.dna)
    confidence = _load(profile.dna_confidence)
    genre_aff = _load(profile.genre_affinity)
    people_aff = _load(profile.people_affinity)
    theme_aff = _load(profile.theme_affinity)

    axes: List[dict] = []
    for a in AXES:
        neg, pos = AXIS_POLES[a]
        val = float(dna.get(a, 0.0))
        conf = float(confidence.get(a, 0.0))
        axes.append({
            "axis": a, "neg": neg, "pos": pos,
            "value": round(val, 3), "confidence": round(conf, 3),
            "lean": (pos if val > 0 else neg) if abs(val) > 0.08 else "balanced",
        })

    # Lazy import keeps the heavy engine module off this router's import path.
    from backend.routers.recommendations import GENRE_MAP
    top_genres = sorted(genre_aff.items(), key=lambda kv: kv[1], reverse=True)[:6]
    genres = [{"name": GENRE_MAP.get(int(g), str(g)), "score": round(float(s), 2)}
              for g, s in top_genres if float(s) > 0]

    names = _people_names(db)
    top_people = sorted(people_aff.items(), key=lambda kv: kv[1], reverse=True)[:6]
    people = [{"name": names.get(int(p), f"#{p}"), "score": round(float(s), 2)}
              for p, s in top_people if float(s) > 0 and int(p) in names]

    top_kw = sorted(theme_aff.items(), key=lambda kv: kv[1], reverse=True)[:10]
    keywords = [k for k, s in top_kw if float(s) > 0]

    mean_conf = round(sum(confidence.values()) / len(confidence), 3) if confidence else 0.0

    return {
        "has_profile": True,
        "n_ratings": n_ratings,
        "mean_confidence": mean_conf,
        "axes": axes,
        "traits": axes_to_words(dna, confidence)[:6],
        "genres": genres,
        "people": people[:6],
        "keywords": keywords,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }

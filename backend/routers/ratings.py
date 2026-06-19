import json
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Rating, WatchlistItem

router = APIRouter()


class RatingCreate(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    genres: Optional[List[str]] = []
    year: Optional[int] = None
    # 1–5 only — an out-of-range value flows into int(rating)-3 taste weights and
    # would poison the whole DNA profile (audit M2).
    rating: float = Field(ge=1, le=5)


def serialize(r: Rating) -> dict:
    return {
        "id": r.id,
        "tmdb_id": r.tmdb_id,
        "title": r.title,
        "poster_path": r.poster_path,
        "genres": json.loads(r.genres) if r.genres else [],
        "year": r.year,
        "rating": r.rating,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("/")
def get_ratings(
    limit: int = Query(1000, ge=1, le=5000),  # bounded so the response can't grow unbounded (audit L8)
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (db.query(Rating).order_by(Rating.created_at.desc())
            .offset(offset).limit(limit).all())
    return [serialize(r) for r in rows]


def _upsert_rating(db: Session, data: "RatingCreate") -> Rating:
    """Create or update a rating in the current transaction (no commit)."""
    r = db.query(Rating).filter(Rating.tmdb_id == data.tmdb_id).first()
    if r:
        r.rating = data.rating
    else:
        r = Rating(
            tmdb_id=data.tmdb_id, title=data.title, poster_path=data.poster_path,
            genres=json.dumps(data.genres), year=data.year, rating=data.rating,
        )
        db.add(r)
    return r


@router.post("/")
def upsert_rating(data: RatingCreate, db: Session = Depends(get_db)):
    r = _upsert_rating(db, data)
    db.commit()
    db.refresh(r)
    return serialize(r)


@router.post("/rate-and-watch")
def rate_and_watch(data: RatingCreate, db: Session = Depends(get_db)):
    """Rate a movie AND mark it watched in ONE transaction (audit M1) — replaces the two
    sequential, non-atomic client calls in `lib/api.ts:rateAndAddWatched`."""
    r = _upsert_rating(db, data)
    w = db.query(WatchlistItem).filter(WatchlistItem.tmdb_id == data.tmdb_id).first()
    now = datetime.now(timezone.utc)
    if w:
        w.watched = True
        w.post_watch_rating = data.rating
        w.watched_at = now
    else:
        w = WatchlistItem(
            tmdb_id=data.tmdb_id, title=data.title, poster_path=data.poster_path,
            genres=json.dumps(data.genres), year=data.year,
            watched=True, post_watch_rating=data.rating, watched_at=now,
        )
        db.add(w)
    db.commit()
    db.refresh(r)
    return serialize(r)


@router.delete("/{tmdb_id}")
def delete_rating(tmdb_id: int, db: Session = Depends(get_db)):
    r = db.query(Rating).filter(Rating.tmdb_id == tmdb_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rating not found")
    db.delete(r)
    db.commit()
    return {"message": "Deleted"}

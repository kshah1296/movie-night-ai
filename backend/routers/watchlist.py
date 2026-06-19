import json
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import WatchlistItem, Rating

router = APIRouter()


class WatchlistAdd(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    genres: Optional[List[str]] = []
    year: Optional[int] = None
    watched: Optional[bool] = False
    post_watch_rating: Optional[float] = Field(default=None, ge=1, le=5)


class WatchlistUpdate(BaseModel):
    watched: Optional[bool] = None
    post_watch_rating: Optional[float] = Field(default=None, ge=1, le=5)


def serialize(item: WatchlistItem) -> dict:
    return {
        "id": item.id,
        "tmdb_id": item.tmdb_id,
        "title": item.title,
        "poster_path": item.poster_path,
        "genres": json.loads(item.genres) if item.genres else [],
        "year": item.year,
        "watched": item.watched,
        "post_watch_rating": item.post_watch_rating,
        "added_at": item.added_at.isoformat() if item.added_at else None,
        "watched_at": item.watched_at.isoformat() if item.watched_at else None,
    }


@router.get("/")
def get_watchlist(
    limit: int = Query(1000, ge=1, le=5000),  # bounded response (audit L8)
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (db.query(WatchlistItem).order_by(WatchlistItem.added_at.desc())
            .offset(offset).limit(limit).all())
    return [serialize(i) for i in rows]


@router.post("/")
def add_to_watchlist(item: WatchlistAdd, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    existing = db.query(WatchlistItem).filter(WatchlistItem.tmdb_id == item.tmdb_id).first()

    if existing:
        # Upsert: if rating call triggered this, mark as watched
        if item.watched:
            existing.watched = True
            if not existing.watched_at:
                existing.watched_at = now
        if item.post_watch_rating is not None:
            existing.post_watch_rating = item.post_watch_rating
        db.commit()
        db.refresh(existing)
        return serialize(existing)

    db_item = WatchlistItem(
        tmdb_id=item.tmdb_id,
        title=item.title,
        poster_path=item.poster_path,
        genres=json.dumps(item.genres),
        year=item.year,
        watched=item.watched or False,
        post_watch_rating=item.post_watch_rating,
        watched_at=now if item.watched else None,
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return serialize(db_item)


@router.put("/{tmdb_id}")
def update_watchlist_item(tmdb_id: int, update: WatchlistUpdate, db: Session = Depends(get_db)):
    item = db.query(WatchlistItem).filter(WatchlistItem.tmdb_id == tmdb_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Not in watchlist")

    if update.watched is not None:
        item.watched = update.watched
        if update.watched and not item.watched_at:
            item.watched_at = datetime.now(timezone.utc)
    if 'post_watch_rating' in update.model_fields_set:
        item.post_watch_rating = update.post_watch_rating
        if update.post_watch_rating is not None:
            # Keep Rating table in sync so recommendations see this rating
            existing_rating = db.query(Rating).filter(Rating.tmdb_id == tmdb_id).first()
            if existing_rating:
                existing_rating.rating = update.post_watch_rating
            else:
                db.add(Rating(
                    tmdb_id=item.tmdb_id,
                    title=item.title,
                    poster_path=item.poster_path,
                    genres=item.genres,
                    year=item.year,
                    rating=update.post_watch_rating,
                ))

    db.commit()
    db.refresh(item)
    return serialize(item)


@router.delete("/{tmdb_id}")
def remove_from_watchlist(tmdb_id: int, db: Session = Depends(get_db)):
    item = db.query(WatchlistItem).filter(WatchlistItem.tmdb_id == tmdb_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Not in watchlist")
    db.delete(item)
    db.commit()
    return {"message": "Removed"}


@router.get("/share")
def share_watchlist(db: Session = Depends(get_db)):
    return {"watchlist": [serialize(i) for i in db.query(WatchlistItem).all()]}

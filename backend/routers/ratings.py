import json
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Rating

router = APIRouter()


class RatingCreate(BaseModel):
    tmdb_id: int
    title: str
    poster_path: Optional[str] = None
    genres: Optional[List[str]] = []
    year: Optional[int] = None
    rating: float


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
def get_ratings(db: Session = Depends(get_db)):
    return [serialize(r) for r in db.query(Rating).all()]


@router.post("/")
def upsert_rating(data: RatingCreate, db: Session = Depends(get_db)):
    existing = db.query(Rating).filter(Rating.tmdb_id == data.tmdb_id).first()
    if existing:
        existing.rating = data.rating
        db.commit()
        db.refresh(existing)
        return serialize(existing)

    r = Rating(
        tmdb_id=data.tmdb_id,
        title=data.title,
        poster_path=data.poster_path,
        genres=json.dumps(data.genres),
        year=data.year,
        rating=data.rating,
    )
    db.add(r)
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

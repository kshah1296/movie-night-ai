from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import RecFeedback

router = APIRouter()

# "shown" rows are written only by the recommendations engine, never by the client.
ALLOWED_ACTIONS = {"not_interested"}


class FeedbackCreate(BaseModel):
    tmdb_id: int
    title: Optional[str] = None
    action: str = "not_interested"


def serialize(f: RecFeedback) -> dict:
    return {
        "id": f.id,
        "tmdb_id": f.tmdb_id,
        "title": f.title,
        "action": f.action,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


@router.get("/")
def list_feedback(db: Session = Depends(get_db)):
    rows = (
        db.query(RecFeedback)
        .filter(RecFeedback.action == "not_interested")
        .order_by(RecFeedback.created_at.desc())
        .all()
    )
    return [serialize(f) for f in rows]


@router.post("/")
def add_feedback(data: FeedbackCreate, db: Session = Depends(get_db)):
    if data.action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail="action must be one of: not_interested")
    existing = (
        db.query(RecFeedback)
        .filter(RecFeedback.tmdb_id == data.tmdb_id, RecFeedback.action == data.action)
        .first()
    )
    if existing:
        return serialize(existing)
    row = RecFeedback(tmdb_id=data.tmdb_id, title=data.title, action=data.action)
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize(row)


@router.delete("/{tmdb_id}")
def remove_feedback(tmdb_id: int, db: Session = Depends(get_db)):
    """Undo a 'not interested' (used by the toast Undo button)."""
    deleted = (
        db.query(RecFeedback)
        .filter(RecFeedback.tmdb_id == tmdb_id, RecFeedback.action == "not_interested")
        .delete()
    )
    db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="No feedback for that movie")
    return {"message": "Deleted"}

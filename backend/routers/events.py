from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import RecEvent

router = APIRouter()

# Events the client is allowed to log. "impression" is server-only (written by the
# recommendations engine), so it's intentionally excluded here.
CLIENT_EVENTS = {
    "click", "trailer", "share", "watchlist_add", "watchlist_remove", "skip",
}


class EventCreate(BaseModel):
    tmdb_id: int
    event_type: str
    bucket: Optional[str] = None
    position: Optional[int] = None


@router.post("/")
def log_event(data: EventCreate, db: Session = Depends(get_db)):
    if data.event_type not in CLIENT_EVENTS:
        raise HTTPException(
            status_code=400,
            detail=f"event_type must be one of: {', '.join(sorted(CLIENT_EVENTS))}",
        )
    row = RecEvent(
        tmdb_id=data.tmdb_id,
        event_type=data.event_type,
        bucket=data.bucket,
        position=data.position,
    )
    db.add(row)
    db.commit()
    return {"ok": True}

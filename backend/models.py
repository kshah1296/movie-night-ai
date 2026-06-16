from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime
from sqlalchemy.sql import func
from backend.database import Base



class Rating(Base):
    __tablename__ = "ratings"

    id = Column(Integer, primary_key=True)
    tmdb_id = Column(Integer, unique=True, nullable=False)
    title = Column(String, nullable=False)
    poster_path = Column(String)
    genres = Column(String)  # JSON string
    year = Column(Integer)
    rating = Column(Float, nullable=False)  # 1–5
    created_at = Column(DateTime, server_default=func.now())


class WatchlistItem(Base):
    __tablename__ = "watchlist"

    id = Column(Integer, primary_key=True)
    tmdb_id = Column(Integer, unique=True, nullable=False)
    title = Column(String, nullable=False)
    poster_path = Column(String)
    genres = Column(String)  # JSON string
    year = Column(Integer)
    watched = Column(Boolean, default=False)
    post_watch_rating = Column(Float, nullable=True)
    added_at = Column(DateTime, server_default=func.now())
    watched_at = Column(DateTime, nullable=True)


class MovieFacets(Base):
    """TMDB keywords + credits for a movie the user has rated/watchlisted.
    Fetched once per movie, then read forever — this is the enrichment cache."""
    __tablename__ = "movie_facets"

    tmdb_id = Column(Integer, primary_key=True, autoincrement=False)
    keywords = Column(String)            # JSON list of keyword names
    directors = Column(String)           # JSON list of [person_id, name]
    top_cast = Column(String)            # JSON list of [person_id, name] (top 5 billed)
    original_language = Column(String)
    runtime = Column(Integer, nullable=True)
    year = Column(Integer, nullable=True)
    fetched_at = Column(DateTime, server_default=func.now())


class RecFeedback(Base):
    """Feedback on served recommendations.
    action = "not_interested" (user clicked ✕; hard-excluded + used as an avoid exemplar)
    action = "shown"          (auto-logged on serve; soft 3-day penalty so refresh rotates)"""
    __tablename__ = "rec_feedback"

    id = Column(Integer, primary_key=True)
    tmdb_id = Column(Integer, nullable=False, index=True)
    title = Column(String)
    action = Column(String, nullable=False)
    created_at = Column(DateTime, server_default=func.now())


class TasteAnalysis(Base):
    """Cached LLM taste reading, keyed on the md5 of sorted (tmdb_id, rating) pairs.
    Re-generated only when ratings change; old rows are deleted on write."""
    __tablename__ = "taste_analysis"

    fingerprint = Column(String, primary_key=True)
    payload = Column(String, nullable=False)  # JSON: {tone, search_keywords, people, wildcard}
    created_at = Column(DateTime, server_default=func.now())

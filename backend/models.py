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


class MovieRatingsCache(Base):
    """External critic/audience scores (OMDb: IMDb + Rotten Tomatoes + Metacritic).
    Fetched once per movie, then read from here — protects the OMDb free-tier
    quota (1000/day). Refreshed only when a row is older than the TTL."""
    __tablename__ = "movie_ratings_cache"

    tmdb_id = Column(Integer, primary_key=True, autoincrement=False)
    imdb = Column(String, nullable=True)             # "8.8"
    imdb_votes = Column(String, nullable=True)       # "2,400,123"
    imdb_id = Column(String, nullable=True)          # "tt1375666"
    rotten_tomatoes = Column(String, nullable=True)  # "91%"
    metacritic = Column(String, nullable=True)       # "74/100"
    fetched_at = Column(DateTime, server_default=func.now())


class MovieDNA(Base):
    """Taste-DNA vector for a movie: 10 bipolar axes in [-1, 1] + extracted themes.
    Fetched once, read forever (same pattern as MovieFacets/MovieRatingsCache).
    source = 'proxy' (deterministic, instant) or 'llm' (Groq-scored, richer). Proxy
    rows are upgraded to llm as the per-request batch backlog drains."""
    __tablename__ = "movie_dna"

    tmdb_id = Column(Integer, primary_key=True, autoincrement=False)
    axes = Column(String)         # JSON: {pace, focus, tone, ...} floats in [-1, 1]
    themes = Column(String)       # JSON list of theme strings
    source = Column(String, default="proxy")  # "proxy" | "llm"
    fetched_at = Column(DateTime, server_default=func.now())


class TasteProfile(Base):
    """Aggregated Taste DNA for a user (single-profile app; user_id future-proofs
    multi-user). Rebuilt only when the ratings fingerprint changes."""
    __tablename__ = "taste_profile"

    user_id = Column(String, primary_key=True, default="local")
    dna = Column(String)              # JSON: aggregated {axis: value}
    dna_confidence = Column(String)   # JSON: {axis: 0..1}
    genre_affinity = Column(String)   # JSON: {genre_id: score}
    people_affinity = Column(String)  # JSON: {person_id: score}
    theme_affinity = Column(String)   # JSON: {keyword: score}
    fingerprint = Column(String)      # ratings md5 — skip rebuild when unchanged
    updated_at = Column(DateTime, server_default=func.now())


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


class RecEvent(Base):
    """Implicit-feedback + impression event stream that powers /analytics.
    event_type: impression (served, logged server-side) | click | trailer | share |
    watchlist_add | watchlist_remove | skip. Impressions also carry the bucket, the
    served position, the deterministic predicted_score, and vote_count (for novelty)."""
    __tablename__ = "rec_events"

    id = Column(Integer, primary_key=True)
    tmdb_id = Column(Integer, nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    bucket = Column(String, nullable=True)
    position = Column(Integer, nullable=True)
    predicted_score = Column(Float, nullable=True)
    vote_count = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)


class TasteAnalysis(Base):
    """Cached LLM taste reading, keyed on the md5 of sorted (tmdb_id, rating) pairs.
    Re-generated only when ratings change; old rows are deleted on write."""
    __tablename__ = "taste_analysis"

    fingerprint = Column(String, primary_key=True)
    payload = Column(String, nullable=False)  # JSON: {tone, search_keywords, people, wildcard}
    created_at = Column(DateTime, server_default=func.now())

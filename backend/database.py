from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from backend.config import settings

SQLALCHEMY_DATABASE_URL = settings.database_url

# check_same_thread is a SQLite-only connect arg; don't pass it to Postgres etc.
_connect_args = {"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from backend.models import Base as ModelsBase
    ModelsBase.metadata.create_all(bind=engine)
    _apply_sqlite_migrations()


def _apply_sqlite_migrations():
    """Minimal idempotent migrations for additive changes `create_all` can't apply to
    EXISTING tables (no Alembic yet — see audit M8). SQLite only; safe to run every boot."""
    if not SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
        return
    from sqlalchemy import text
    with engine.begin() as conn:
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(movie_facets)"))}
        if cols and "imdb_id" not in cols:  # audit H3
            conn.execute(text("ALTER TABLE movie_facets ADD COLUMN imdb_id VARCHAR"))
        dna_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(movie_dna)"))}
        if dna_cols and "model_version" not in dna_cols:  # audit M6
            conn.execute(text("ALTER TABLE movie_dna ADD COLUMN model_version VARCHAR"))
            # Existing rows were produced by the current model — stamp them v1 so they
            # aren't needlessly invalidated; future prompt/axis changes bump the version.
            conn.execute(text("UPDATE movie_dna SET model_version = '1' WHERE model_version IS NULL"))
        # audit H5 — composite indexes for the engine/analytics filters
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_rec_feedback_action_created "
                          "ON rec_feedback (action, created_at)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_rec_events_type_created "
                          "ON rec_events (event_type, created_at)"))

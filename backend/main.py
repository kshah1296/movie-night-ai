import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend.database import init_db
from backend.http_client import close_http_client
from backend.routers import (
    movies, ratings, watchlist, recommendations, rec_feedback, events, analytics, taste,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("movienight")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info(
        "Startup OK — db=%s · groq=%s · omdb=%s · origins=%s",
        settings.database_url.split("://", 1)[0],
        "on" if settings.groq_api_key else "off",
        "on" if settings.omdb_api_key else "off",
        settings.allowed_origins,
    )
    yield
    await close_http_client()


app = FastAPI(title="Movie Night AI", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(movies.router, prefix="/movies", tags=["movies"])
app.include_router(ratings.router, prefix="/ratings", tags=["ratings"])
app.include_router(watchlist.router, prefix="/watchlist", tags=["watchlist"])
app.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
app.include_router(rec_feedback.router, prefix="/rec_feedback", tags=["rec_feedback"])
app.include_router(events.router, prefix="/events", tags=["events"])
app.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
app.include_router(taste.router, prefix="/taste", tags=["taste"])

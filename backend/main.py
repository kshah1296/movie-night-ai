from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database import init_db
from backend.routers import movies, ratings, watchlist, recommendations, rec_feedback

app = FastAPI(title="Movie Night AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


app.include_router(movies.router, prefix="/movies", tags=["movies"])
app.include_router(ratings.router, prefix="/ratings", tags=["ratings"])
app.include_router(watchlist.router, prefix="/watchlist", tags=["watchlist"])
app.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
app.include_router(rec_feedback.router, prefix="/rec_feedback", tags=["rec_feedback"])

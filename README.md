# 🎬 Movie Night AI

A bold, colorful movie‑recommendation app that learns your taste and tells you what to watch tonight — no more 40‑minute scroll. Rate a few films you've seen, and a **Taste‑DNA** engine builds a personalized, diverse list grounded in real movie data.

> **Status:** MVP 2. The recommendation engine now runs on a deterministic **Taste‑DNA** scorer with diversity buckets (the LLM only profiles + explains), every card shows IMDb/Rotten Tomatoes/Metacritic scores, and the UI has had a full design‑system + accessibility pass.

---

## ✨ Features

- **For You** — a **Taste‑DNA** engine, not just a prompt. Every movie is scored on 10 bipolar axes (fast‑paced ↔ slow‑burn, character ↔ plot‑driven, dark ↔ optimistic, …) to capture *why* you like films. A deterministic hybrid scorer ranks a real TMDB candidate pool; the LLM only writes the explanations.
  - **Diversity buckets** — picks are sorted into **Safe Picks · Hidden Gems · Expand Your Taste · Critically Acclaimed · Underseen Favorites · Wildcard**, with hard caps (no "10 Nolan movies"). Each card shows its bucket.
  - **Smart anchors** — "Inspired by *Inception*" is the nearest film to the pick *by your Taste DNA*.
  - **Moods** (Cozy · Mind‑bender · Date night · Adrenaline) + **Taste × genre** chips
  - **"Your taste" strip** — your inferred DNA traits, plus top genres/people/themes
  - **"Not interested"** (with Undo) and a **streaming filter** to steer + scope picks
- **Scores everywhere** — IMDb, 🍅 Rotten Tomatoes, and Metacritic on every card and in the modal (OMDb, cached).
- **Discover** — a **poster‑forward grid**, sort + filter drawer (genre, decade, rating, runtime, streaming provider), title search with debounce, actor/director search, infinite scroll, and shareable URL‑encoded filters.
- **Watchlist** — built to answer *"what do I watch tonight?"*: **sort** (recently added · shortest runtime · highest rated · …), a **📺 "on my services"** filter that shows only what's streamable on your Netflix/Disney+/…, **runtime** filters, provider badges + runtime on each card, and a **🎲 Surprise me** button. Plus Up Next / Watched tabs, post‑watch ratings, remove with Undo, and a read‑only **Share** page.
- **Movie Night (group mode)** — the app's namesake: add everyone on the couch, each rates a few films, and a **least-misery + average** blend finds one movie *nobody* hates (not a bland average). Each pick shows a per-person fit ("you: loves it · Alex: likes it"). Guests persist locally for your recurring crew.
- **Ratings** — manage everything you've rated; these power the recommendations.
- **Taste DNA page** — a radar of your 10 taste axes (slow‑burn ↔ fast, cerebral ↔ emotional, …) with per‑axis confidence, plus the genres, people, and themes that shape your picks. Makes the engine's model of you visible.
- **Movie modal** — backdrop, cast, **clickable** streaming providers (deep‑link straight to Netflix/Disney+/…), trailer, and rate/watchlist actions.
- **Learns from your ratings** — a linear **ranker is trained on your feedback** (`backend/train.py`) and only ships if it beats the previous scorer on an offline eval (time‑split, NDCG/Pearson). Ranking stays fully deterministic; the LLM never ranks.
- **Self‑measuring** — every recommendation logs an impression + predicted score; a `GET /analytics` endpoint reports CTR, watchlist conversion, acceptance, rating‑prediction accuracy, novelty, and diversity.
- **Settings** — Dark/Light theme, your default streaming services, and a "Not interested" manager (dismissed picks resurface after ~90 days, or restore them instantly).
- **Power-user & accessible** — a **⌘K command palette** (jump to any movie/person), keyboard-navigable card grids, a stacking multi-undo toast queue, per-page titles, keyboard focus trap in dialogs, screen‑reader semantics, 44px touch targets, reduced‑motion support, WCAG‑contrast text.

---

## 🧱 Tech stack

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 |
| **Backend** | FastAPI · SQLAlchemy · SQLite |
| **Recommendations** | Taste‑DNA features + a **learned linear ranker** (trained on your ratings, eval‑gated) + diversity buckets (`backend/dna.py`, `backend/features.py`, `backend/scoring.py`, `backend/train.py`) |
| **AI** | Groq API — `llama-3.3-70b-versatile` (DNA scoring, taste analysis, explanations) |
| **Movie data** | TMDB (search, posters, cast, trailers, streaming providers) · OMDb (IMDb/RT/Metacritic scores) |

---

## 🚀 Getting started

### Prerequisites
- **Python 3.9+**
- **Node.js 18+**
- A free **[TMDB API key](https://developer.themoviedb.org)** and a free **[Groq API key](https://console.groq.com)**

### 1. Clone
```bash
git clone <your-repo-url>
cd movie-night-ai
```

### 2. Configure environment
```bash
# Backend keys (repo root)
cp .env.example .env
#   → edit .env and add your TMDB_API_KEY and GROQ_API_KEY

# Frontend (points at the backend)
cp frontend/.env.local.example frontend/.env.local
```

### 3. Backend (run from the repo root)
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```
The SQLite database (`movie_night.db`) is created automatically on first launch.

### 4. Frontend
```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

### Or run both at once
```bash
./start.sh           # starts backend (:8000) and frontend (:3000), Ctrl+C stops both
```

### Tests
The backend has a deterministic unit suite (no network) in [`tests/unit/`](./tests/unit) covering the
Taste‑DNA math, the hybrid scorer, bucketing + diversity caps, the taste‑profile builder, and the
analytics metrics.
```bash
venv/bin/pip install -r requirements-dev.txt
venv/bin/pytest                                  # run the suite
venv/bin/pytest --cov=backend --cov-report=term-missing   # with coverage
```

---

## 📂 Project structure

```
movie-night-ai/
├── backend/                 # FastAPI app (run from repo root)
│   ├── main.py              # entry point, CORS, router registration
│   ├── database.py          # SQLAlchemy engine + init_db()
│   ├── models.py            # Rating, WatchlistItem, MovieFacets, MovieRatingsCache, MovieMetaCache,
│   │                        #   MovieDNA, TasteProfile(+Snapshot), RecFeedback, RecEvent, TasteAnalysis
│   ├── config.py            # pydantic-settings (DATABASE_URL, ALLOWED_ORIGINS, API keys)
│   ├── dna.py               # Taste-DNA: 10 axes, proxy + LLM scoring, aggregation, distance
│   ├── features.py          # shared train/serve feature extractor + learned-model application
│   ├── scoring.py           # ranker (learned weights if active, else hand-tuned) + buckets + MMR
│   ├── train.py             # learned-ranker trainer (numpy Ridge, eval-gated)
│   ├── eval.py              # offline rec-quality eval harness (time-split, NDCG/Pearson)
│   ├── alembic/             # DB migrations
│   └── routers/             # movies, ratings, watchlist, recommendations,
│                            #   rec_feedback, events, analytics
├── tests/unit/              # pytest suite: dna, scoring, profile builder, analytics, eval
├── frontend/                # Next.js 16 App Router
│   ├── app/                 # For You (/), Discover (/search), Watchlist, Ratings, Share
│   ├── components/          # MovieCard, PosterCard, Poster, RatingBadges, MovieModal, …
│   └── lib/                 # api.ts, tmdb.ts, streaming.ts, ratings.ts, providers.ts, watchlistMeta.ts
├── Improvement_plans/       # design + QA planning docs
├── pytest.ini               # test config (pythonpath, testpaths)
├── requirements-dev.txt     # test deps (pytest, pytest-cov)
├── .env.example             # backend env template
└── start.sh                 # run backend + frontend together
```

---

## 🔌 API overview (FastAPI, `localhost:8000`)

| Endpoint | Purpose |
|----------|---------|
| `GET /recommendations` | Taste‑DNA picks with buckets. Params: `refresh`, `genre`, `mood`, `providers` |
| `GET /movies/discover` | Flexible TMDB browse (genre/year/rating/runtime/provider/people/keyword) |
| `GET /movies/search`, `/trending`, `/person_search`, `/{id}`, `/{id}/providers` | TMDB proxies |
| `GET /movies/{id}/ratings`, `GET /movies/ratings?ids=` | IMDb/RT/Metacritic scores (OMDb, cached) — single + batch |
| `GET /movies/meta?ids=` | Runtime + streaming providers per movie (cached) — powers the watchlist sort/filter |
| `GET /taste` | Your Taste‑DNA profile — 10 axes + confidence + top genres/people/themes (powers the Taste DNA page) |
| `POST /recommendations/group` | Group "Movie Night" — blend the host + in‑session guests into picks everyone enjoys (least‑misery + average) |
| `GET/POST/DELETE /ratings` | Manage ratings |
| `GET/POST/PUT/DELETE /watchlist` | Manage the watchlist |
| `POST/DELETE /rec_feedback` | "Not interested" signal |
| `POST /events` | Log engagement (click / trailer / share / watchlist / skip) |
| `GET /analytics?days=N` | Recommendation‑quality metrics (CTR, conversion, novelty, diversity, …) |

Interactive docs at **http://localhost:8000/docs** while the backend runs.

---

## 📝 Notes

- **Ranking is deterministic**, so recommendations never degrade — only the LLM‑written *explanations* and Taste‑DNA enrichment pause when Groq's ~100K tokens/day are exhausted (the picks fall back to template reasons and recover when the window rolls over). DNA sharpens over time as movies get LLM‑scored in small per‑request batches.
- **OMDb is optional**: free key at [omdbapi.com](https://www.omdbapi.com/apikey.aspx) — **activate it via the email link** or it returns `Invalid API key!`. Without it, score badges simply hide. Scores are cached, so the 1000/day limit ≈ 1000 *new* movies/day.
- **CORS** is locked to `http://localhost:3000` in `backend/main.py` — update it when deploying.
- Internal design and QA notes live in [`Improvement_plans/`](./Improvement_plans).

---

## 🗺️ Roadmap (post‑MVP) 

- In‑app analytics dashboard (the `/analytics` data, visualized)
- LLM movie clustering into named taste clusters
- Decouple "rate" from "mark watched" (optional)
- "Not interested" management view + exclusion decay
- Multi‑item undo queue
- Deployment (Vercel + a hosted API)

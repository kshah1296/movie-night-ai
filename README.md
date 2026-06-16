# 🎬 Movie Night AI

A bold, colorful movie‑recommendation app that learns your taste and tells you what to watch tonight — no more 40‑minute scroll. Rate a few films you've seen, and an LLM builds a personalized list grounded in real movie data.

> **Status:** MVP 1. Core loops (rate → recommend → watchlist) are complete and the UI has had a full accessibility + UX pass.

---

## ✨ Features

- **For You** — AI recommendations from a two‑stage grounded pipeline: a real TMDB candidate pool is retrieved across multiple channels (similar films, your favorite keywords/people, hidden gems, a wildcard), then an LLM ranks and explains each pick ("Inspired by *Inception*").
  - **Moods** — Cozy · Mind‑bender · Date night · Adrenaline
  - **Taste × genre** — a fixed genre chip set conditions the picks on your taste *and* the genre you ask for
  - **"Your taste" strip** — shows what the engine inferred (genres, people, themes)
  - **"Not interested"** — dismiss a pick (with Undo) to steer future recs
  - **Streaming filter** — limit picks to the services you actually have
  - **Refresh** — a genuinely different set each tap
- **Discover** — sort + a filter drawer (genre, decade, rating, runtime, streaming provider), title search with debounce, actor/director search, infinite scroll, and shareable URL‑encoded filters.
- **Watchlist** — Up Next / Watched tabs, post‑watch ratings, remove with Undo, and a read‑only **Share** page.
- **Ratings** — manage everything you've rated; these power the recommendations.
- **Movie modal** — backdrop, cast, streaming providers (JustWatch), trailer, and rate/watchlist actions.
- **Accessible & responsive** — keyboard focus trap in dialogs, screen‑reader semantics, 44px touch targets, reduced‑motion support, WCAG‑contrast text.

---

## 🧱 Tech stack

| Layer | Stack |
|-------|-------|
| **Frontend** | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 |
| **Backend** | FastAPI · SQLAlchemy · SQLite |
| **AI** | Groq API — `llama-3.3-70b-versatile` |
| **Movie data** | TMDB API (search, posters, cast, trailers, streaming providers) |

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

---

## 📂 Project structure

```
movie-night-ai/
├── backend/                 # FastAPI app (run from repo root)
│   ├── main.py              # entry point, CORS, router registration
│   ├── database.py          # SQLAlchemy engine + init_db()
│   ├── models.py            # Rating, WatchlistItem, MovieFacets, RecFeedback, TasteAnalysis
│   └── routers/             # movies, ratings, watchlist, recommendations, rec_feedback
├── frontend/                # Next.js 16 App Router
│   ├── app/                 # For You (/), Discover (/search), Watchlist, Ratings, Share
│   ├── components/          # MovieCard, MovieModal, StarRating, Toast, PageHeader, …
│   └── lib/                 # api.ts (fetch layer), tmdb.ts, streaming.ts
├── Improvement_plans/       # design + QA planning docs
├── .env.example             # backend env template
└── start.sh                 # run backend + frontend together
```

---

## 🔌 API overview (FastAPI, `localhost:8000`)

| Endpoint | Purpose |
|----------|---------|
| `GET /recommendations` | AI picks. Params: `refresh`, `genre`, `mood`, `providers` |
| `GET /movies/discover` | Flexible TMDB browse (genre/year/rating/runtime/provider/people/keyword) |
| `GET /movies/search`, `/trending`, `/person_search`, `/{id}`, `/{id}/providers` | TMDB proxies |
| `GET/POST/DELETE /ratings` | Manage ratings |
| `GET/POST/PUT/DELETE /watchlist` | Manage the watchlist |
| `POST/DELETE /rec_feedback` | "Not interested" signal |

Interactive docs at **http://localhost:8000/docs** while the backend runs.

---

## 📝 Notes

- **Groq free tier** caps at ~100K tokens/day. When exhausted, the engine transparently falls back to similarity‑based picks (the UI says "AI ranking is resting") and recovers when the window rolls over.
- **CORS** is locked to `http://localhost:3000` in `backend/main.py` — update it when deploying.
- Internal design and QA notes live in [`Improvement_plans/`](./Improvement_plans).

---

## 🗺️ Roadmap (post‑MVP) 

- Decouple "rate" from "mark watched" (optional)
- "Not interested" management view + exclusion decay
- Multi‑item undo queue
- Streaming‑aware ranking once services are declared globally
- Deployment (Vercel + a hosted API)

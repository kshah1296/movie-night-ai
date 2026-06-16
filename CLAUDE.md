# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Movie Night AI — a bold, colorful movie recommendation app. **Status: MVP 1** (pushed to GitHub;
public-facing README at repo root).
- **Frontend**: Next.js 16 + Tailwind v4 + TypeScript (`frontend/`)
- **Backend**: FastAPI (Python 3.9) + SQLite (`backend/`)
- **AI**: **Groq API (Llama 3.3 70B)** for personalized recommendations (replaced Gemini — it hit quota limit `0`)
- **Movie data**: TMDB API for search, posters, metadata, trailers, streaming providers

**Repo hygiene (for GitHub):** `.gitignore` (root) excludes `.env`, `venv/`, `__pycache__/`,
`*.db`, `node_modules/`, `.next/`, `.claude/`. Secrets are templated in `.env.example` (root) and
`frontend/.env.local.example` — never commit real keys. `README.md` (root) is the public-facing
setup/feature doc; this file is the internal working guide.

> **⚠️ Never run `next build` (production) while a `npm run dev` server is live** — they share
> `frontend/.next/` and the build wipes the dev server's manifests, causing 500s. Fix: stop dev,
> `rm -rf frontend/.next`, restart `npm run dev`.

## Commands

### Backend
```bash
# From repo root — install deps (use a venv)
python3 -m venv venv && source venv/bin/activate
pip install -r backend/requirements.txt

# Run the API server (must be run from repo root, not inside backend/)
uvicorn backend.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev      # localhost:3000
npm run build    # do NOT run while `npm run dev` is live (see warning above)
npm run lint
npx tsc --noEmit  # type check only
```

### Both at once
```bash
./start.sh        # backend (:8000) + frontend (:3000), Ctrl+C stops both
```

## Architecture

### Backend (`backend/`)
FastAPI app, run from the **repo root** (the `backend/` folder is a Python package).

| File | Purpose |
|------|---------|
| `main.py` | App entry point; loads `.env`, registers routers, sets up CORS |
| `database.py` | SQLAlchemy engine + `get_db` dependency + `init_db()` |
| `models.py` | `Rating`, `WatchlistItem`, `MovieFacets` (TMDB keyword/credit cache), `RecFeedback` (not_interested + shown), `TasteAnalysis` (cached LLM taste reading) |
| `routers/movies.py` | TMDB proxy: `/search`, `/trending`, `/discover` (sort + genre/year/rating/runtime/provider/people/keyword filters), `/person_search`, `/{id}`, `/{id}/providers` |
| `routers/ratings.py` | `GET/POST /ratings`, `DELETE /ratings/{tmdb_id}` |
| `routers/watchlist.py` | Full CRUD + upsert on POST |
| `routers/recommendations.py` | V2 engine — see Key backend details below |
| `routers/rec_feedback.py` | `GET/POST /rec_feedback` (not_interested only), `DELETE /rec_feedback/{tmdb_id}` (Undo) |

SQLite DB file (`movie_night.db`) is created at the repo root on first startup; `init_db()` auto-creates any new tables (never ALTERs existing ones).

#### Key backend details
- **Recommendations V2** (`routers/recommendations.py`): 5-stage pipeline — (0) facet enrichment: TMDB keywords/directors/cast per rated movie, cached forever in `movie_facets`, ≤15 fetches/request; (1) weighted taste profile (5★=+2 … 1★=−2, watchlist=+1) → top keywords, loved people, favorite decade; (2) Groq taste analysis cached in `taste_analysis` keyed on ratings fingerprint (runs only when ratings change); (3) multi-channel candidate retrieval — similar/keywords/people/hidden-gem/popular/wildcard, round-robin interleaved to 36; (4) Groq rank & explain (returns `anchor` per pick, ≥3 hidden gems, 1 wildcard). Params: `refresh=N` (cache-bust + new seed), `genre=Name` (scopes ALL channels), `mood=cozy|mind-bender|date-night|adrenaline` (server-side `MOODS` presets), `providers=8,337` (streaming filter — scopes discover channels, drops `similar` channel since TMDB can't provider-filter it). Response includes `taste` strip object + `anchor`/`channel` per rec. Serving logs `shown` rows in `rec_feedback` (3-day soft rotation penalty, 14-day TTL); `not_interested` rows are hard-excluded and used as avoid-exemplars in the prompt. Falls back to `source: "tmdb"` with template reasons when Groq fails (e.g. free-tier 100K tokens/day limit — common; recovers automatically).
- **Movies** (`routers/movies.py`): `/discover` is the flexible proxy (`sort_by`, `genres`, `year_gte/lte`, `min_rating`, `runtime_gte/lte`, `providers`, `people`, `keywords` — commas converted to TMDB pipe-OR). `/person_search` and `/{id}/providers` MUST be declared before `/{tmdb_id}` (route shadowing). `GET /movies/{id}` uses `append_to_response=credits,videos`.
- **Watchlist** (`routers/watchlist.py`): POST is an upsert. PUT uses `update.model_fields_set` to detect explicit `null` for `post_watch_rating` (allows clearing a rating), vs the field simply being omitted.
- **Python 3.9**: always `Optional[X]` / `List[X]` / `Dict[K, V]` from `typing` — **never `X | None`** (this has crashed the server before).

### Frontend (`frontend/`)
Next.js 16 App Router. All pages are client components (`"use client"`).

| Path | Purpose |
|------|---------|
| `app/page.tsx` | For You — V2 recs with mood pills + fixed genre chips (mode bar), "Your taste" strip, per-card Not Interested ✕ with Undo, streaming-only toggle + service chips, mode-aware header |
| `app/search/page.tsx` | Discover — sort selector + filter drawer (genres/decade/rating/runtime/providers), text search, person pivot, infinite scroll, URL-as-state (`useSearchParams` in `<Suspense>`) |
| `app/watchlist/page.tsx` | Up Next / Watched tabs, genre chips, mark watched, post-watch rating, remove with Undo |
| `app/ratings/page.tsx` | Grid of all rated movies — edit or remove ratings |
| `app/share/page.tsx` | Read-only public watchlist view — static border tiles (no hover effect) |
| `lib/api.ts` | All fetch calls to FastAPI. Uses `cache: "no-store"` globally to prevent browser HTTP caching |
| `lib/tmdb.ts` | `posterUrl()`, `genreIdsToNames()`, `GENRE_MAP` |
| `lib/streaming.ts` | `STREAMING_PROVIDERS` (8 TMDB US provider ids) + localStorage persistence for the streaming-only toggle and selected services (used by For You) |
| `components/MovieCard.tsx` | Shared rec/search card — poster + vote badge, optional `kicker` ("Because you loved X") and `onDismiss` (Not Interested ✕) props |
| `components/StarRating.tsx` | 1–5 star rating; click current star to clear; `.star-filled` pop animation |
| `components/MovieModal.tsx` | Full detail modal: backdrop, cast, streaming providers (JustWatch), trailer link, rate/watchlist |
| `components/Toast.tsx` | Slide-up/slide-down toast; supports `actionLabel`/`onAction` for Undo |
| `components/SkeletonCard.tsx` | Shimmer skeleton card + `SkeletonGrid` utility (used in search/watchlist/ratings) |
| `components/Nav.tsx` | Sticky nav (For You / Discover / Watchlist / My Ratings) with mobile media query |

### Styling
Tailwind v4 — configured via `@import "tailwindcss"` and `@theme` in `globals.css` (no `tailwind.config.js`). All custom styles are in `globals.css`.

**Custom CSS classes in `globals.css`:**
- `.gradient-text` — purple→pink→orange gradient text
- `.gradient-border` — dark card with gradient border on hover + lift
- `.poster-frame img` — zooms poster 6% on parent `.gradient-border:hover`
- `.btn-primary` / `.btn-secondary` — standard button styles
- `.chip` / `.chip.chip-active` — genre filter pills (**note: use double-class `.chip.chip-active` for specificity over Tailwind**)
- `.tab` / `.tab.tab-active` — category/status toggle buttons (same double-class pattern)
- `.nav-link` — nav link hover state
- `.skeleton` — shimmer loading animation
- `.card-in` — card entrance animation (use with `animationDelay` for stagger)
- `.star-filled` — star pop animation on rating change
- `.spinner` / `.spin-icon` — loading spinner
- `body::before` — ambient purple/pink glow at top of page
- `@keyframes modal-backdrop-in` / `@keyframes modal-pop` — modal open animations
- `@keyframes toast-slide-up` / `@keyframes toast-slide-down` — toast enter/exit
- `:focus-visible` — purple outline for keyboard nav
- `@media (max-width: 520px)` on `.nav-inner`/`.nav-links` — mobile nav wrap

**CSS specificity gotcha with Tailwind v4**: Active state overrides (e.g. chip selected, tab active) must use combined selectors like `.chip.chip-active` rather than `.chip-active` alone, otherwise Tailwind's layer ordering can override the single-class rule.

## Environment Variables

`.env` (repo root, read by FastAPI via `python-dotenv`):
```
TMDB_API_KEY=...
GROQ_API_KEY=...
OMDB_API_KEY=...   # OPTIONAL — IMDb/Rotten Tomatoes/Metacritic scores in the modal
```

`frontend/.env.local` (read by Next.js):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**TMDB key**: free at https://developer.themoviedb.org
**Groq key**: free at https://console.groq.com
**OMDb key** (optional): free at https://www.omdbapi.com/apikey.aspx — if unset, the modal hides the external rating badges (TMDB score still shows).

## Key Design Decisions

- **AI provider**: Groq (Llama 3.3 70B) replaces Gemini. Gemini quota was `limit: 0` (hit free tier cap). Groq is faster and free.
- **Optimistic UI**: All mutation handlers (rate, watchlist, remove) follow the pattern: snapshot state → update optimistically → `await` network call → revert on `catch`. Never `await` before updating UI.
- **Genres**: TMDB search returns `genre_ids` (integers); `genreIdsToNames()` in `lib/tmdb.ts` maps them client-side. Full movie details return named genres. The backend `recommendations.py` has its own `GENRE_MAP` for the TMDB fallback path (which returns `genre_ids`).
- **Watchlist persistence**: All frontend fetches use `cache: "no-store"` (set globally in `lib/api.ts` `req()`) to prevent browser HTTP caching of `GET /watchlist` across navigation.
- **Streaming providers**: `GET /movies/{id}/providers` proxies TMDB's JustWatch data. The route must be declared before `GET /movies/{id}` in `routers/movies.py` to avoid FastAPI route shadowing.
- **Trailer**: Modal finds the first YouTube `type="Trailer"` video from `movie.videos.results`. Rendered as a plain `<a className="btn-secondary">` — never nest `<button>` inside `<a>`.
- **Share page**: `/share` reads the same `/watchlist` endpoint. Tiles use static border (`border: 1px solid #27272a`) not `.gradient-border` — no hover interactivity on a read-only page.
- **Watchlist modal**: Clicking a watchlist card opens `MovieModal`. On close, the watchlist re-fetches from the backend to sync any rating/watched changes the modal made.
- **Post-watch rating null clearing**: Backend `WatchlistUpdate.post_watch_rating` is `Optional[float] = None`. The handler uses `'post_watch_rating' in update.model_fields_set` to distinguish "explicitly set to null" (clear rating) from "not included in payload" (leave unchanged). Frontend sends `null` to clear.
- **CORS**: FastAPI allows `http://localhost:3000` only. Update `main.py` when deploying.

## Current Feature Set (MVP 1, as of June 2026)

- **For You page**: V2 AI recs (Groq) with "Inspired by X" anchors, 4 mood pills (Cozy/Mind-bender/Date night/Adrenaline), fixed 12-genre chip list, "What we've learned" taste strip (inferred genres/people/keywords), per-card Not Interested ✕ with Undo (deferred-persist undo window), 📺 streaming-only toggle + service chips (localStorage), inline refresh, mode-aware header ("Thriller night, for you"), first-run onboarding panel, neutral "✨ For You" badge with an honest fallback note when the LLM ranker is down
- **Discover page**: Sort selector (popularity/rating/newest/revenue) + filter drawer (multi-genre AND, decade, min rating, runtime, 8 streaming providers), text search with debounce + person pivot, infinite scroll (race-guarded), active filter chips, URL-as-state shareable filters
- **Watchlist page**: Up Next / Watched tabs with counts, genre chips, mark watched/unwatch, post-watch rating (clearable), remove with Undo (restores at original position), "🔗 Share list" button, modal on card click
- **Ratings page**: Grid of all rated movies, edit rating in place, remove
- **Movie modal**: Backdrop image, poster, cast, streaming providers (JustWatch flatrate + rent), trailer link (YouTube), rate/watchlist actions, modal pop animation, focus trap + background `aria-hidden`
- **Share page**: Read-only watchlist for sharing — poster grid split into Up Next / Already Watched

## Design & QA history (see `Improvement_plans/`)

The app went through three documented passes; the planning docs are committed for reference:
- **`UI-UX-REDESIGN.md`** — design-system pass: tokens (`--text-*`, `--accent`, …), shared
  `PageHeader`/`EmptyState` components, `.btn-ghost-danger`, one-primary-per-view hierarchy.
- **`QA-FINDINGS.md`** — three-persona QA simulation (first-timer / power-user / mobile+a11y),
  44 findings with a Resolution log at the bottom marking what's fixed vs. consciously deferred.
- Engine docs: `RECOMMENDATION-ENGINE-REBUILD.md`, `RECOMMENDATION-QUALITY-V2.md`, `SEARCH-PAGE-REBUILD.md`.

**Accessibility baseline (from the QA pass):** 44px touch targets on coarse pointers, dialog focus
trap, `aria-pressed` on toggles, `aria-current` on nav, `role="status"` toasts, `prefers-reduced-motion`
support, `.sr-only` loading labels, WCAG-contrast text via `--text-3`. Keep these when adding UI.

**A Roulette page existed briefly and was removed at the user's request — do not reintroduce it.**

## Known limits

- **Groq free tier = 100K tokens/day.** Each rec request burns ~3–4K tokens on the ranking call. When exhausted, the engine falls back to `source: "tmdb"` (grounded picks + template reasons, no anchors/tone) and the For You page shows an honest "AI ranking is resting" note; it recovers when the window rolls over. Check usage at console.groq.com.
- **Deferred (post-MVP, tracked in `QA-FINDINGS.md`):** decoupling rate-from-watched, a "Not interested" management view + exclusion decay, a multi-item undo queue.

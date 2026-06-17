# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Movie Night AI — a bold, colorful movie recommendation app. **Status: MVP 2** (pushed to GitHub;
public-facing README at repo root).
- **Frontend**: Next.js 16 + Tailwind v4 + TypeScript (`frontend/`)
- **Backend**: FastAPI (Python 3.9) + SQLite (`backend/`)
- **Recommendation engine (V3 — Taste DNA)**: a **deterministic** hybrid scorer ranks candidates and
  sorts them into product buckets with diversity guarantees; the **LLM only profiles + explains** (no
  longer ranks). See "Recommendation engine V3" below.
- **AI**: **Groq API (Llama 3.3 70B)** for Taste-DNA scoring, taste analysis, and explanations (replaced
  Gemini — it hit quota limit `0`)
- **Movie data**: TMDB API for search, posters, metadata, trailers, streaming providers; **OMDb** for
  IMDb/Rotten Tomatoes/Metacritic scores on every card + the modal

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
| `models.py` | `Rating`, `WatchlistItem`, `MovieFacets` (TMDB keyword/credit cache), `MovieRatingsCache` (OMDb scores, fetch-once + 14-day TTL), `MovieDNA` (10-axis Taste-DNA vector + themes per movie, proxy→llm), `TasteProfile` (aggregated user DNA + affinities, singleton), `RecFeedback` (not_interested + shown), `RecEvent` (impression + click/trailer/share/skip stream for analytics), `TasteAnalysis` (cached LLM taste reading) |
| `routers/movies.py` | TMDB proxy: `/search`, `/trending`, `/discover` (sort + genre/year/rating/runtime/provider/people/keyword filters), `/person_search`, `/{id}`, `/{id}/providers`, `/{id}/ratings` (OMDb, DB-cached) + **batch** `/ratings?ids=` |
| `routers/ratings.py` | `GET/POST /ratings`, `DELETE /ratings/{tmdb_id}` |
| `routers/watchlist.py` | Full CRUD + upsert on POST |
| `routers/recommendations.py` | V3 Taste-DNA engine — see Key backend details below |
| `routers/rec_feedback.py` | `GET/POST /rec_feedback` (not_interested only), `DELETE /rec_feedback/{tmdb_id}` (Undo) |
| `routers/events.py` | `POST /events` — logs client engagement (click/trailer/share/watchlist_add/remove/skip); `impression` is server-only |
| `routers/analytics.py` | `GET /analytics?days=N` — CTR, watchlist conversion, acceptance, rating-prediction correlation, novelty, diversity (backend-only, curlable) |
| `dna.py` | Pure module: 10 Taste-DNA axes, `proxy_dna()` (deterministic), `llm_score_dna()` (Groq), `aggregate_profile_dna()`, `dna_distance()`, `axes_to_words()` |
| `scoring.py` | Pure module: `score_candidate()` (hybrid formula), `assign_bucket()`, `select_with_buckets_mmr()` (diversity caps). Replaces LLM ranking. Unit-tested in `tests/unit/` |

SQLite DB file (`movie_night.db`) is created at the repo root on first startup; `init_db()` auto-creates any new tables (never ALTERs existing ones).

#### Key backend details
- **Recommendation engine V3 — Taste DNA** (`routers/recommendations.py` + `dna.py` + `scoring.py`):
  ranking is now **deterministic and reproducible**; the LLM only profiles + writes prose. Pipeline:
  - **Stage 0** facet enrichment (TMDB keywords/directors/cast) cached forever in `movie_facets`, ≤15
    fetches/request; now enriches candidates too (powers the scorer's director/actor affinity + the MMR director cap).
  - **Stage 1** weighted taste profile (5★=+2 … 1★=−2, watchlist=+1) → loved genres/keywords/people/decade
    (`_build_profile`, also returns raw `people_scores`).
  - **Stage 2** Groq taste analysis cached in `taste_analysis` on the ratings fingerprint (retrieval keywords/wildcard/tone).
  - **Stage 3** multi-channel candidate retrieval (similar/keywords/people/hidden-gem/popular/wildcard),
    round-robin interleaved to 36. Candidate dicts now carry `genre_ids`, `vote_count`, `popularity`.
  - **Stage 3.5 Taste DNA** (`_ensure_dna`): every rated movie + candidate gets a 10-axis vector
    (`pace, focus, tone, mode, realism, texture, scale, concept, humor, complexity`, each [-1,1]) — a free
    deterministic **proxy** (`dna.proxy_dna`) instantly, **LLM-upgraded** ≤`DNA_BATCH_LIMIT=8`/request
    (rated first), persisted in `movie_dna` (proxy→llm), backlog draining across requests (same pattern as facets).
    `aggregate_profile_dna` confidence-weights rated-movie vectors into the user DNA → persisted in `taste_profile` (on ratings change).
  - **Stage 4 deterministic scoring** (`scoring.score_candidate`): hybrid score = 0.34·DNA-similarity +
    0.16·genre + 0.10·director + 0.08·actor + 0.14·theme + 0.06·freshness + 0.12·discovery − 0.10·popularity,
    confidence-blended. `assign_bucket` → **Safe Picks / Hidden Gems / Expand Your Taste / Critically
    Acclaimed / Underseen Favorites / Wildcard**. `select_with_buckets_mmr` serves a fixed mix (3/2/2/2/2/1)
    with hard diversity caps (**≤2 same director, ≤4 same genre, ≤2 same decade**) — no recommendation tunnels.
    `anchor` per pick is the **deterministic** nearest loved movie by DNA distance.
  - **Stage 5 explanations** (`_groq_explain`): one Groq call writes a DNA-aware one-liner per final pick
    (template fallback `_template_reason_v2` when Groq is down — uses DNA words + anchor).
  - Params unchanged: `refresh=N`, `genre=Name`, `mood=cozy|mind-bender|date-night|adrenaline`, `providers=8,337`.
    Response: `taste` strip (now includes `dna` trait words) + per-rec `anchor`/`channel`/`bucket`/`bucket_reason`.
    Serving logs `shown` (rec_feedback, 3-day rotation/14-day TTL) **and** `impression` rows in `rec_events`
    (bucket/position/predicted_score/vote_count; 90-day TTL) + persists served picks' DNA. `not_interested`
    hard-excluded. Falls back to `source: "tmdb"` template reasons when Groq is exhausted (ranking is unaffected — it's deterministic).
- **Movies** (`routers/movies.py`): `/discover` is the flexible proxy (`sort_by`, `genres`, `year_gte/lte`, `min_rating`, `runtime_gte/lte`, `providers`, `people`, `keywords` — commas converted to TMDB pipe-OR). `/person_search`, `/{id}/providers`, `/{id}/ratings`, **and the batch `/ratings`** MUST be declared before `/{tmdb_id}` (route shadowing — `/movies/ratings` would otherwise be captured by the int path param). `GET /movies/{id}` uses `append_to_response=credits,videos`.
- **External ratings (OMDb)** (`routers/movies.py`): `/{id}/ratings` and batch `/ratings?ids=` return IMDb/RT/Metacritic, DB-cached in `movie_ratings_cache` (fetch-once, 14-day TTL; cap 30 ids/request, concurrency 5). Returns `{}` gracefully when `OMDB_API_KEY` is unset. The frontend `lib/ratings.ts` `useCardRatings()` hook batch-loads per grid page; `RatingBadges` renders them on every card + the modal.
- **Analytics** (`routers/events.py` + `routers/analytics.py`): `rec_events` is the impression + engagement stream. The engine logs `impression` rows on serve; the frontend `lib/api.ts` `logEvent()` (fire-and-forget) logs `click`/`trailer`/`share`/`watchlist_add`/`skip`. `GET /analytics` derives CTR, watchlist conversion, acceptance, rating-prediction Pearson r (predicted_score vs actual rating), novelty, and DNA-distance diversity. Backend-only.
- **Watchlist** (`routers/watchlist.py`): POST is an upsert. PUT uses `update.model_fields_set` to detect explicit `null` for `post_watch_rating` (allows clearing a rating), vs the field simply being omitted.
- **Python 3.9**: always `Optional[X]` / `List[X]` / `Dict[K, V]` from `typing` — **never `X | None`** (this has crashed the server before).

### Frontend (`frontend/`)
Next.js 16 App Router. All pages are client components (`"use client"`).

| Path | Purpose |
|------|---------|
| `app/page.tsx` | For You — Taste-DNA recs with mood pills + genre chips, "Your taste" strip (DNA traits + genres/people/keywords), **per-card bucket tag**, per-card Not Interested ✕ with Undo, streaming-only toggle, mode-aware header. Logs `click`/`watchlist_add`/`skip` events |
| `app/search/page.tsx` | Discover — **poster-forward grid** (`PosterCard`), sort selector + filter drawer (genres/decade/rating/runtime/providers), text search, person pivot, infinite scroll, URL-as-state (`useSearchParams` in `<Suspense>`) |
| `app/watchlist/page.tsx` | Up Next / Watched tabs, genre chips, mark watched, post-watch rating, remove with Undo |
| `app/ratings/page.tsx` | Grid of all rated movies — edit or remove ratings |
| `app/share/page.tsx` | Read-only public watchlist view — static border tiles (no hover effect) |
| `lib/api.ts` | All fetch calls to FastAPI (`cache: "no-store"` globally). Includes `getMovieRatingsBatch()` and `logEvent()` (fire-and-forget analytics) |
| `lib/tmdb.ts` | `posterUrl()`, `genreIdsToNames()`, `GENRE_MAP` |
| `lib/streaming.ts` | `STREAMING_PROVIDERS` (8 TMDB US provider ids) + localStorage persistence for the streaming-only toggle |
| `lib/ratings.ts` | `useCardRatings()` hook (session-cached, batched, deduped external-score loader) + `rtIsFresh()` |
| `lib/providers.ts` | `providerLink(providerId, title, fallback)` — best-effort deep links to each streaming/store service (opens the service searched for the title; falls back to the JustWatch page) |
| `components/MovieCard.tsx` | For-You card (horizontal) — `Poster` + ratings badges, AI explanation, `kicker` ("Inspired by X"), `bucket` tag, `onDismiss` (Not Interested ✕) |
| `components/PosterCard.tsx` | Discover card (poster-forward) — full-bleed poster + title/meta + ratings badges + inline rate/watchlist |
| `components/Poster.tsx` | Shared poster-frame primitive (image/🎬 fallback + optional vote / watched badges) — used by MovieCard, watchlist, ratings |
| `components/RatingBadges.tsx` | Compact TMDB/🍅 RT/IMDb/MC score row, reused on cards + modal (renders nothing when scores absent) |
| `components/StarRating.tsx` | 1–5 star rating; click current star to clear; `.star-filled` pop animation |
| `components/MovieModal.tsx` | Full detail modal: backdrop, cast, **clickable** streaming providers (deep links), trailer link, rate/watchlist; focus trap (focuses the dialog, not the ✕) |
| `components/Toast.tsx` | Slide-up/slide-down toast; supports `actionLabel`/`onAction` for Undo |
| `components/SkeletonCard.tsx` | Shimmer skeleton + `SkeletonGrid({ variant: "row" | "poster" })` (Discover uses `poster`) |
| `components/PageHeader.tsx` / `EmptyState.tsx` | Shared page header (solid title) + empty/error state |
| `components/Nav.tsx` | Sticky nav (For You / Discover / Watchlist / My Ratings) with mobile media query |

### Styling
Tailwind v4 — configured via `@import "tailwindcss"` and `@theme` in `globals.css` (no `tailwind.config.js`). All custom styles are in `globals.css`.

**Design tokens in `:root` (polish pass, `2026-06-16-UI-UX-POLISH-PASS.md`):** color tokens
(`--bg/surface/surface-2/surface-3/border/border-strong/text-1..3/accent/danger/gold`), a shadow scale
(`--shadow-sm/md/lg`), radius scale (`--radius-sm/md/lg`), type scale (`--font-xs…--font-3xl`), and a
4px spacing scale (`--space-1…--space-8`). **Prefer these vars over raw hex** in components. Gradient is
reserved for the logo, active chips/nav, and the toast — page titles are solid `--text-1`.

**Custom CSS classes in `globals.css`:**
- `.gradient-text` — purple→pink→orange gradient text (logo / brand moments only)
- `.gradient-border` — card surface with **resting elevation** (`1px border + --shadow-sm`), gradient border + `--shadow-md` lift on hover
- `.poster-frame img` — zooms poster 6% on parent `.gradient-border:hover`
- `.btn-primary` / `.btn-secondary` — standard buttons; `.btn-sm` (compact modifier) and `.btn-icon` (circular icon button)
- `.provider-badge` — clickable streaming/store badge in the modal (deep-links to the service)
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
OMDB_API_KEY=...   # OPTIONAL — IMDb/Rotten Tomatoes/Metacritic scores on every card + the modal
```

`frontend/.env.local` (read by Next.js):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**TMDB key**: free at https://developer.themoviedb.org
**Groq key**: free at https://console.groq.com
**OMDb key** (optional): free at https://www.omdbapi.com/apikey.aspx — **the key must be activated via the email link** or OMDb returns `Invalid API key!`. If unset, cards/modal simply hide the external rating badges (TMDB score still shows). Scores are DB-cached forever (14-day TTL), so the 1000/day free limit ≈ 1000 *new* movies/day.

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

## Current Feature Set (MVP 2, as of June 2026)

- **For You page**: V3 Taste-DNA recs sorted into 6 buckets (per-card **bucket tag**), deterministic "Inspired by X" anchors, 4 mood pills + 12-genre chips, "What we've learned" taste strip (**DNA traits** + genres/people/keywords), external score badges, per-card Not Interested ✕ with Undo, 📺 streaming-only toggle, inline refresh, mode-aware header, first-run onboarding, honest fallback note when the LLM explainer is down
- **Discover page**: **Poster-forward grid** (~4–5/row), sort selector + filter drawer (multi-genre AND, decade, min rating, runtime, 8 streaming providers), text search with debounce + person pivot, infinite scroll (race-guarded), active filter chips, URL-as-state shareable filters
- **Every card**: IMDb / 🍅 Rotten Tomatoes / Metacritic badges (OMDb, batch-loaded + cached)
- **Watchlist page**: Up Next / Watched tabs, genre chips, mark watched/unwatch, post-watch rating (clearable), remove with Undo, "🔗 Share list", modal on card click
- **Ratings page**: Grid of all rated movies, edit rating in place, remove
- **Movie modal**: Backdrop, poster, cast, score badges (TMDB/IMDb/RT/MC), **clickable streaming providers** (deep-link to the service searched for the title), trailer link, rate/watchlist, focus trap (focuses the dialog)
- **Share page**: Read-only watchlist split into Up Next / Already Watched
- **Analytics**: every served rec logs an impression + predicted score; `GET /analytics` reports CTR, conversion, acceptance, prediction accuracy, novelty, diversity

### Testing
- Unit suite lives in **`tests/unit/`** (`test_dna.py`, `test_scoring.py`, `test_recommendations.py`, `test_analytics.py`) — deterministic, no network (the one Groq call is monkeypatched). Config in `pytest.ini` (`pythonpath = .`, `testpaths = tests/unit`).
- Run from repo root: `venv/bin/pytest` · coverage: `venv/bin/pytest --cov=backend --cov-report=term-missing`.
- Dev deps in `requirements-dev.txt` (`venv/bin/pip install -r requirements-dev.txt`).
- Covers the pure logic (Taste-DNA math, hybrid scorer, bucketing + MMR caps, profile builder, analytics math). Router endpoints (DB/HTTP) would need a separate integration suite.

## Design & QA history (see `Improvement_plans/`)

The app went through three documented passes; the planning docs are committed for reference:
- **`UI-UX-REDESIGN.md`** — design-system pass: tokens (`--text-*`, `--accent`, …), shared
  `PageHeader`/`EmptyState` components, `.btn-ghost-danger`, one-primary-per-view hierarchy.
- **`QA-FINDINGS.md`** — three-persona QA simulation (first-timer / power-user / mobile+a11y),
  44 findings with a Resolution log at the bottom marking what's fixed vs. consciously deferred.
- Engine docs: `RECOMMENDATION-ENGINE-REBUILD.md`, `RECOMMENDATION-QUALITY-V2.md`, `SEARCH-PAGE-REBUILD.md`.
- **`2026-06-16-UI-UX-POLISH-PASS.md`** — token scales (shadow/radius/type/spacing), `Poster`/`RatingBadges`
  primitives, card elevation, solid page titles, poster-forward Discover, bucket tags.

**Accessibility baseline (from the QA pass):** 44px touch targets on coarse pointers, dialog focus
trap, `aria-pressed` on toggles, `aria-current` on nav, `role="status"` toasts, `prefers-reduced-motion`
support, `.sr-only` loading labels, WCAG-contrast text via `--text-3`. Keep these when adding UI.

**A Roulette page existed briefly and was removed at the user's request — do not reintroduce it.**

## Known limits

- **Groq free tier = 100K tokens/day**, shared across Taste-DNA scoring (≤8 movies/request), taste analysis, and explanations. **Ranking is deterministic so it never degrades** — only DNA enrichment and prose pause when exhausted (`source: "tmdb"`, template reasons, anchors still work). The DNA backlog (proxy→llm) drains across requests as tokens allow. Check usage at console.groq.com.
- **DNA is eventually-consistent**: a fresh profile starts on deterministic proxy vectors (genre-driven) and sharpens as movies get LLM-scored over subsequent requests. Candidate director/actor affinity + the MMR director cap only bind once a candidate's facets are cached (genre/decade caps always bind).
- **Single-profile**: ratings are global (no auth). `TasteProfile.user_id` defaults to `"local"` to future-proof multi-user.
- **Deferred (tracked in `QA-FINDINGS.md`):** decoupling rate-from-watched, a "Not interested" management view + exclusion decay, a multi-item undo queue, an in-app analytics dashboard, LLM movie clustering.

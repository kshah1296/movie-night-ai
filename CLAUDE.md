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
| `config.py` | `pydantic-settings` `Settings` (singleton `settings`) — `DATABASE_URL`, `ALLOWED_ORIGINS`, API keys; **required `TMDB_API_KEY` (fails fast at startup)** |
| `http_client.py` | One app-lifetime pooled `httpx.AsyncClient` (`get_http_client()`); closed in the lifespan shutdown |
| `database.py` | SQLAlchemy engine (URL from `settings`) + `get_db` + `init_db()` (= `create_all` + `_apply_sqlite_migrations`) |
| `models.py` | `Rating`, `WatchlistItem`, `MovieFacets` (+`imdb_id`), `MovieRatingsCache` (OMDb, 14-day TTL), `MovieMetaCache` (runtime + streaming providers for the watchlist, 7-day TTL), `MovieDNA` (10-axis vector + themes, proxy→llm, **`model_version`** for invalidation), `TasteProfile` (aggregated user DNA, singleton), `TasteProfileSnapshot` (taste timeline, M8), `LearnedModel` (S1: standardized linear ranker weights + gated eval metrics; ≤1 `active`), `RecFeedback` (not_interested + shown), `RecEvent` (impression + click/trailer/share/skip stream), `TasteAnalysis` (cached LLM taste reading) |
| `routers/movies.py` | TMDB proxy: `/search`, `/trending`, `/discover`, `/person_search`, `/{id}`, `/{id}/providers`, `/{id}/ratings` (OMDb) + **batch** `/ratings?ids=`, **batch** `/meta?ids=` (runtime + providers) |
| `routers/ratings.py` | `GET/POST /ratings`, **`POST /ratings/rate-and-watch`** (atomic rate + mark-watched), `DELETE /ratings/{tmdb_id}` |
| `routers/watchlist.py` | Full CRUD + upsert on POST |
| `routers/recommendations.py` | V3 Taste-DNA engine — `build_recommendations()` service + thin route. See Key backend details |
| `routers/rec_feedback.py` | `GET/POST /rec_feedback` (not_interested), `DELETE /rec_feedback/{tmdb_id}` (Undo) |
| `routers/events.py` | `POST /events` — logs client engagement (click/trailer/share/watchlist_add/remove/skip); `impression` is server-only |
| `routers/analytics.py` | `GET /analytics?days=N` (CTR/conversion/acceptance/novelty/diversity), **`/analytics/eval`** (offline rec quality, M5), **`/analytics/taste-history`** (DNA timeline, M8) — backend-only |
| `routers/taste.py` | **`GET /taste`** — user-facing Taste-DNA profile (10 axes w/ pole labels + per-axis confidence, top genres/people/themes) read from the persisted `taste_profile`. Powers the `/taste` page (UX18) |
| `dna.py` | Pure module: 10 axes + `DNA_MODEL_VERSION`, `proxy_dna()`, `llm_score_dna()` (Groq), `aggregate_profile_dna()`, `dna_distance()`, `axes_to_words()` |
| `features.py` | Pure module (S1): `extract_features()` — the ONE candidate→features function, shared by train + serve (zero skew); `apply_model()` (standardized linear); `load_active_model()`. `FEATURE_NAMES` = the 10 model inputs (incl. de-saturated `genre_affinity_norm` ex-M4 + `dna_is_proxy` ex-M3) |
| `scoring.py` | Pure module: `score_candidate()` (calls `features.extract_features`; weighted by the active **learned model** if one exists, else the hand-tuned `W_*` fallback), `assign_bucket()`, `select_with_buckets_mmr()` (diversity caps + discovery fit-floor). Unit-tested |
| `train.py` | S1 learned-ranker trainer (run `venv/bin/python -m backend.train`): numpy closed-form **Ridge** over `features.FEATURE_NAMES`, **leave-one-out** training features (profile rebuilt without each movie → no self-leak, mirrors serving), alpha by k-fold CV on train, **gated by `eval.py`** — persists a `LearnedModel` (refit on all ratings) ONLY if it beats the hand-tuned baseline. `--dry-run` to gate without persisting |
| `eval.py` | **Offline eval harness (M5)** — time-split, NDCG@k + Pearson/Spearman + calibrated RMSE. `python -m backend.eval` or `GET /analytics/eval` |

DB file (`movie_night.db`) created at repo root on first startup. **`init_db()`** runs `create_all` (new tables) + `_apply_sqlite_migrations()` (idempotent additive `ALTER`s — `imdb_id`, `model_version`). **Alembic is adopted** (`backend/alembic/`, baseline stamped) for structural migrations going forward; run `venv/bin/alembic revision --autogenerate -m "…"` then `alembic upgrade head`.

#### Key backend details
- **Recommendation engine V3 — Taste DNA** (`routers/recommendations.py` + `dna.py` + `scoring.py`):
  ranking is now **deterministic and reproducible**; the LLM only profiles + writes prose. Pipeline:
  - **Stage 0** facet enrichment (TMDB keywords/directors/cast) cached forever in `movie_facets`, ≤15
    fetches/request; now enriches candidates too (powers the scorer's director/actor affinity + the MMR director cap).
  - **Stage 1** weighted taste profile (`_build_profile`) folds in **all feedback signals**: explicit
    ratings (5★=+2…1★=−2), **watched watchlist post-ratings** (Q1), watchlist intent (+1), **clicks/trailer
    views on unrated movies** (engagement, M1: +0.4/+0.7 capped), and **dismissals as negative taste**
    (Q2: −1.5, most-recent 25, decaying) → loved/disliked genres, keywords, people, decade, `people_scores`.
  - **Stage 2** Groq taste analysis cached in `taste_analysis` on the rating fingerprint (retrieval keywords/wildcard/tone).
  - **Stage 3** multi-channel retrieval (similar/keywords/people/hidden-gem/popular/wildcard), round-robin
    interleaved to **`POOL_SIZE=60`**; **cold-start** (<`COLD_START_MIN=4` signals) injects a trending channel (Q5).
    Candidate dicts carry `genre_ids`, `vote_count`, `popularity`.
  - **Stage 3.5 Taste DNA** (`_ensure_dna`): every rated movie + candidate gets a 10-axis vector
    (`pace, focus, tone, mode, realism, texture, scale, concept, humor, complexity`, each [-1,1]) — a free
    deterministic **proxy** instantly, **LLM-upgraded** ≤`DNA_BATCH_LIMIT=8`/request (rated first), persisted in
    `movie_dna` (proxy→llm). Rows whose **`model_version` ≠ `dna.DNA_MODEL_VERSION`** are treated as stale +
    recomputed (M6 — bump the constant to invalidate). `aggregate_profile_dna` confidence-weights the signals
    into the user DNA (dismissals/engagement included) → `taste_profile` + a `taste_profile_snapshots` timeline row (M8).
  - **Stage 4 deterministic scoring** (`scoring.score_candidate` via `features.extract_features`): if a
    `LearnedModel` is **active** (S1), the score is its standardized-linear combination of the 10 features —
    weights *learned from your ratings*, which fixed the hand-tuned signs (offline Pearson −0.15→+0.23). With no
    active model it falls back to the hand-tuned hybrid (0.34·DNA-sim + 0.16·genre + 0.10·director + 0.08·actor +
    0.14·theme + 0.06·freshness + 0.12·discovery − 0.10·popularity), confidence-blended. Either way: −0.10·rotation
    (recently-shown), seeded jitter, then `assign_bucket` → **Safe Picks / Hidden Gems / Expand Your Taste /
    Critically Acclaimed / Underseen Favorites / Wildcard**. `select_with_buckets_mmr` is **score-first** with a
    target mix but a **discovery fit-floor** (M7 — a niche pick must score ≥80% of the top pick to claim a
    reserved slot) + hard caps (**≤2 director, ≤4 genre, ≤2 decade**). `anchor` = deterministic nearest loved movie by DNA.
  - **Stage 5 explanations** (`_groq_explain`): one Groq call per final pick; template fallback `_template_reason_v2`.
  - Params: `refresh=N`, `genre=Name`, `mood=…`, `providers=…`. Response: `taste` strip (`dna` traits +
    `confidence`), per-rec `anchor`/`channel`/`bucket`/`bucket_reason`, and a `cold_start` flag + message (Q5).
    The **response cache busts on any ratings/watchlist/dismissal change** (Q6 state fingerprint). Serving logs
    `shown` (rec_feedback rotation) **and** `impression` rows (rec_events) + persists served DNA. `not_interested`
    is hard-excluded but **decays** (`DISMISS_EXCLUDE_DAYS=90`, UX5 — older dismissals resurface; manage/restore them on `/settings`).
    Falls back to `source:"tmdb"` template reasons when Groq is exhausted (ranking unaffected — deterministic).
- **Movies** (`routers/movies.py`): `/discover` is the flexible proxy (`sort_by`, `genres`, `year_gte/lte`, `min_rating`, `runtime_gte/lte`, `providers`, `people`, `keywords` — commas converted to TMDB pipe-OR). `/person_search`, `/{id}/providers`, `/{id}/ratings`, **and the batch `/ratings`** MUST be declared before `/{tmdb_id}` (route shadowing — `/movies/ratings` would otherwise be captured by the int path param). `GET /movies/{id}` uses `append_to_response=credits,videos`.
- **External ratings (OMDb)** (`routers/movies.py`): `/{id}/ratings` and batch `/ratings?ids=` return IMDb/RT/Metacritic, DB-cached in `movie_ratings_cache` (fetch-once, 14-day TTL; cap 30 ids/request, concurrency 5). Returns `{}` gracefully when `OMDB_API_KEY` is unset. The frontend `lib/ratings.ts` `useCardRatings()` hook batch-loads per grid page; `RatingBadges` renders them on every card + the modal.
- **Analytics** (`routers/events.py` + `routers/analytics.py`): `rec_events` is the impression + engagement stream. The engine logs `impression` rows on serve; the frontend `lib/api.ts` `logEvent()` (fire-and-forget) logs `click`/`trailer`/`share`/`watchlist_add`/`skip`. `GET /analytics` derives CTR, watchlist conversion, acceptance, rating-prediction Pearson r (predicted_score vs actual rating), novelty, and DNA-distance diversity. Backend-only.
- **Watchlist** (`routers/watchlist.py`): POST is an upsert. PUT uses `update.model_fields_set` to detect explicit `null` for `post_watch_rating` (clear a rating) vs the field omitted. `GET /watchlist` takes `limit`/`offset`.
- **Watchlist "find a movie tonight"** (`movies.py` `/meta?ids=` + `lib/watchlistMeta.ts`): batch endpoint returns `{id: {runtime, providers[]}}` (one TMDB `append_to_response=watch/providers` call/movie, cached in `movie_meta_cache`, 7-day TTL since availability drifts). MUST be declared before `/{tmdb_id}` (route shadowing). The watchlist page uses it for **sort** (added/oldest/shortest/highest-rated/year/title), the **"📺 On my services"** streaming filter (shares the For You service set via `lib/streaming`), **runtime** chips, per-card provider badges + runtime, and a **🎲 Surprise me** random pick.
- **Python 3.9**: always `Optional[X]` / `List[X]` / `Dict[K, V]` from `typing` — **never `X | None`** (this has crashed the server before).

### Frontend (`frontend/`)
Next.js 16 App Router. All pages are client components (`"use client"`).

| Path | Purpose |
|------|---------|
| `app/page.tsx` | For You — Taste-DNA recs with mood pills + genre chips, "Your taste" strip (DNA traits + genres/people/keywords), **per-card bucket tag**, per-card Not Interested ✕ with Undo, streaming-only toggle, mode-aware header. Logs `click`/`watchlist_add`/`skip` events |
| `app/search/page.tsx` | Discover — **poster-forward grid** (`PosterCard`), sort selector + filter drawer (genres/decade/rating/runtime/providers), text search, person pivot, infinite scroll, URL-as-state (`useSearchParams` in `<Suspense>`) |
| `app/watchlist/page.tsx` | Up Next / Watched tabs, **sort** (added/oldest/shortest/rating/year/title), **📺 streaming filter** + service picker, **runtime** chips, provider badges + runtime on cards, **🎲 Surprise me**, genre chips, mark watched, post-watch rating, remove with Undo |
| `app/ratings/page.tsx` | Grid of all rated movies — edit or remove ratings |
| `app/taste/page.tsx` | **Taste DNA** (UX18) — SVG radar of the 10 bipolar axes (center=neg pole, edge=pos pole, dashed mid-ring=neutral, dot size=confidence) + per-axis diverging bars + top genres/people/themes. Reads `GET /taste` |
| `app/settings/page.tsx` | **Settings** (UX4/5/8) — Dark/Light theme toggle, default streaming-services picker (shared `lib/streaming` set), and a "Not interested" management list with one-tap Restore |
| `app/share/page.tsx` | Read-only public watchlist view — static border tiles (no hover effect) |
| `lib/api.ts` | All fetch calls to FastAPI (`cache: "no-store"` globally). Includes `getMovieRatingsBatch()` and `logEvent()` (fire-and-forget analytics) |
| `lib/tmdb.ts` | `posterUrl()`, `genreIdsToNames()`, `GENRE_MAP` |
| `lib/streaming.ts` | `STREAMING_PROVIDERS` (8 TMDB US provider ids) + localStorage persistence for the shared "my services" set (For You + Watchlist) |
| `lib/ratings.ts` | `useCardRatings()` hook (session-cached, batched, deduped external-score loader) + `rtIsFresh()` |
| `lib/useDocumentTitle.ts` | UX10 — sets per-page tab title (client pages can't export Next `metadata`) |
| `lib/theme.ts` | UX8 — dark/light theme get/set/apply + `THEME_INIT_SCRIPT` (pre-paint, no-flash inline script run from the layout) |
| `lib/gridNav.ts` | UX2 — `gridArrowNav` arrow-key roving across `[data-card]` grid items |
| `lib/watchlistMeta.ts` | `useWatchMeta()` hook — batched runtime + streaming-provider loader for the watchlist (mirrors `useCardRatings`) |
| `lib/providers.ts` | `providerLink(providerId, title, fallback)` — best-effort deep links to each streaming/store service (opens the service searched for the title; falls back to the JustWatch page) |
| `components/MovieCard.tsx` | For-You card (horizontal) — `Poster` + ratings badges, AI explanation, `kicker` ("Inspired by X"), `bucket` tag, `onDismiss` (Not Interested ✕) |
| `components/PosterCard.tsx` | Discover card (poster-forward) — full-bleed poster + title/meta + ratings badges + inline rate/watchlist |
| `components/Poster.tsx` | Shared poster-frame primitive (image/🎬 fallback + optional vote / watched badges) — used by MovieCard, watchlist, ratings |
| `components/RatingBadges.tsx` | Compact TMDB/🍅 RT/IMDb/MC score row, reused on cards + modal (renders nothing when scores absent) |
| `components/StarRating.tsx` | 1–5 star rating; click current star to clear; `.star-filled` pop animation |
| `components/MovieModal.tsx` | Full detail modal: backdrop, cast, **clickable** streaming providers (deep links), trailer link, rate/watchlist; focus trap (focuses the dialog, not the ✕) |
| `components/ToastProvider.tsx` | UX7 — global **stacking** toast queue (`<ToastProvider>` in layout + `useToast()` push). Each toast self-times + carries its own Undo closure, so multiple recent actions are independently undoable (replaced the old single `Toast.tsx`) |
| `components/SkeletonCard.tsx` | Shimmer skeleton + `SkeletonGrid({ variant: "row" | "poster" })` (Discover uses `poster`) |
| `components/PageHeader.tsx` / `EmptyState.tsx` | Shared page header (solid title) + empty/error state |
| `components/CommandPalette.tsx` | UX1 — global ⌘K/Ctrl-K palette (mounted in layout): debounced movie+person search, ↑↓/↵ nav, jumps to Discover. Also opens via a window event from the Nav 🔍 button |
| `components/Nav.tsx` | Sticky nav (For You / Discover / Watchlist / My Ratings / Taste DNA / Settings) + a 🔍 ⌘K palette trigger; `--nav-bg` token (themed); mobile media query |

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
- **Watchlist page**: Up Next / Watched tabs + a "find a movie tonight" toolkit — sort (recently added / oldest / shortest runtime / highest rated / newest / title), 📺 streaming filter ("on my services") with provider badges + runtime on each card, runtime chips, 🎲 Surprise-me random pick, genre chips, mark watched/unwatch, post-watch rating, remove with Undo, "🔗 Share list", modal on card click
- **Ratings page**: Grid of all rated movies, edit rating in place, remove
- **Taste DNA page** (`/taste`, UX18): visualizes the learned taste profile — an SVG radar of the 10 bipolar axes (dot size = per-axis confidence, dashed mid-ring = neutral) + a precise per-axis diverging-bar breakdown + top genres/people/themes. Read-only; refreshed whenever For You rebuilds the profile
- **Settings page** (`/settings`): Dark/Light theme toggle (UX8), default streaming-services picker (UX4), "Not interested" management + Restore (UX5)
- **Command palette** (⌘K, UX1): global movie/person search → jump to Discover. **Keyboard-navigable card grids** (UX2). Per-page tab titles (UX10), content fade-in (UX9), "Why this pick?" card expander (UX3), pool-exhaustion + onboarding nudges (UX11/UX14)
- **Movie modal**: Backdrop, poster, cast, score badges (TMDB/IMDb/RT/MC), **clickable streaming providers** (deep-link to the service searched for the title), trailer link, rate/watchlist, focus trap (focuses the dialog)
- **Share page**: Read-only watchlist split into Up Next / Already Watched
- **Analytics**: every served rec logs an impression + predicted score; `GET /analytics` reports CTR, conversion, acceptance, prediction accuracy, novelty, diversity

### Testing & evaluation
- Unit suite in **`tests/unit/`** (`test_dna.py`, `test_scoring.py`, `test_recommendations.py`, `test_analytics.py`, `test_eval.py`, `test_features.py`) — deterministic, no network (Groq monkeypatched). Config in `pytest.ini`. Run `venv/bin/pytest`; dev deps in `requirements-dev.txt`. Frontend: `cd frontend && npm test` (Vitest).
- **Offline eval gate** (`backend/eval.py`, run `venv/bin/python -m backend.eval`): time-split ratings → Pearson/Spearman/NDCG@k/calibrated-RMSE. This is the **acceptance test for any ranking change** — and what `train.py` uses to decide whether a learned model ships.
- **Offline rec eval (`backend/eval.py`, M5)** — `venv/bin/python -m backend.eval` or `GET /analytics/eval`. Time-splits ratings, scores held-out movies, reports NDCG@k + Pearson/Spearman + RMSE. **This gates rec changes** — run before/after, keep only if metrics improve. It has already gated out three hand-tuning attempts (M4, Q4, M3).
- **Known limitation it surfaced:** the hand-tuned scorer is ~random/anti-correlated with held-out ratings — the *feature signs are wrong*, which per-term tweaks can't fix. The real fix is a **learned ranker (S1)**. See `Improvement_plans/2026-06-17-RECOMMENDATION-REVIEW-BOARD.md` and `2026-06-19-LOW-CONFIDENCE-RESEARCH.md`. **Do not ship per-term scorer tweaks without an eval win.**

## Design & QA history (see `Improvement_plans/`)

The app went through three documented passes; the planning docs are committed for reference:
- **`UI-UX-REDESIGN.md`** — design-system pass: tokens (`--text-*`, `--accent`, …), shared
  `PageHeader`/`EmptyState` components, `.btn-ghost-danger`, one-primary-per-view hierarchy.
- **`QA-FINDINGS.md`** — three-persona QA simulation (first-timer / power-user / mobile+a11y),
  44 findings with a Resolution log at the bottom marking what's fixed vs. consciously deferred.
- Engine docs: `RECOMMENDATION-ENGINE-REBUILD.md`, `RECOMMENDATION-QUALITY-V2.md`, `SEARCH-PAGE-REBUILD.md`.
- **`2026-06-16-UI-UX-POLISH-PASS.md`** — token scales, `Poster`/`RatingBadges` primitives, poster-forward Discover.
- **`2026-06-16-PRINCIPAL-ENGINEER-AUDIT.md`** — independent prod-readiness audit (the C-tier launch blockers).
- **`2026-06-17-RECOMMENDATION-REVIEW-BOARD.md`** — 4 independent reviewers + VP synthesis of the rec engine.
- **`2026-06-19-LOW-CONFIDENCE-RESEARCH.md`** — evidence that per-term scorer tweaks don't help; promote S1.
- **Live backlog: `to-do.md` (repo root)** — an Obsidian-Kanban board of all open work, priority-ordered.

**Accessibility baseline (from the QA pass):** 44px touch targets on coarse pointers, dialog focus
trap, `aria-pressed` on toggles, `aria-current` on nav, `role="status"` toasts, `prefers-reduced-motion`
support, `.sr-only` loading labels, WCAG-contrast text via `--text-3`. Keep these when adding UI.

**A Roulette page existed briefly and was removed at the user's request — do not reintroduce it.**

## Known limits

- **Groq free tier = 100K tokens/day**, shared across Taste-DNA scoring (≤8 movies/request), taste analysis, and explanations. **Ranking is deterministic so it never degrades** — only DNA enrichment and prose pause when exhausted (`source: "tmdb"`, template reasons, anchors still work). The DNA backlog (proxy→llm) drains across requests as tokens allow. Check usage at console.groq.com.
- **DNA is eventually-consistent**: a fresh profile starts on deterministic proxy vectors (genre-driven) and sharpens as movies get LLM-scored over subsequent requests. Candidate director/actor affinity + the MMR director cap only bind once a candidate's facets are cached (genre/decade caps always bind).
- **Single-profile**: ratings are global (no auth). `TasteProfile.user_id` defaults to `"local"` to future-proof multi-user. Multi-user + Postgres + auth/rate-limiting are the **launch-gating C-tier** (audit) — required before any public deploy.
- **Scorer quality**: the ranker is now the **learned model (S1)** — `train.py` fit standardized-linear weights that beat the hand-tuned baseline on the eval (Pearson −0.15→+0.23, Spearman −0.24→+0.23, NDCG +0.025) and is the active model. The hand-tuned weights stay as the fallback. **Retrain (`venv/bin/python -m backend.train`) as ratings accumulate** — it only ships a new model if it still beats the gate. `eval.py`'s `vote_average`/`vote_count` are held at neutral constants, so `discovery`/`pop_penalty` have ~0 learned weight; they still vary (and matter) at serve time.
- **Config/infra**: `settings` (pydantic-settings) drives `DATABASE_URL`/`ALLOWED_ORIGINS`; one pooled `httpx` client; `lifespan` (not `on_event`); logging via the `logging` module. Alembic for migrations.
- **Deferred (see `to-do.md`):** embedding/ANN retrieval (S2) + principled exploration / bandits (S4); a "Not interested" management view; retention features (weekly digest, streaming alerts, Taste Profile page, group mode).

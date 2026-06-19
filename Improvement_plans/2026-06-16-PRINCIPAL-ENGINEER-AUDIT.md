# Principal Engineer Audit — Movie Night AI

_Independent review, 2026-06-16. Reviewer had no prior knowledge of the codebase; every claim below is grounded in the actual source._

# Executive Summary

This is an impressive **single-user hobby/portfolio app** wearing the costume of a production system. The recommendation engine is genuinely the strongest part: it is a real candidate-generation → enrichment → deterministic-hybrid-scoring → bucketed-MMR-diversity → LLM-explanation pipeline, with caching layers (SQLite-backed facets/DNA/ratings, in-process response cache), graceful LLM-failure fallbacks, and an analytics event stream that computes CTR, novelty, diversity, and a predicted-vs-actual Pearson correlation. The pure logic (`dna.py`, `scoring.py`) is well-factored and genuinely unit-tested. The frontend is careful about optimistic UI, undo windows, race-guarded infinite scroll, focus traps, and accessibility. For a side project this is well above average.

But measured against the bar the prompt sets — _"reviewing a production system before approving it for a major public launch... assume malicious users exist... 100 → 10,000 → 1,000,000 users"_ — it is **not production-ready and not close.** The single disqualifying fact dominates everything: **there is no concept of a user.** Every table is global. `Rating`, `WatchlistItem`, `TasteProfile (user_id="local")`, and `RecFeedback` are shared by every visitor. The moment a second person uses the deployed app, they rate movies into the same global pool, see each other's watchlist on a public `/share` page, and poison each other's taste profile. This is not a bug to fix at scale; it is an architectural absence that invalidates the entire data model the instant the app is multi-tenant.

Layered on top: SQLite with `check_same_thread=False` and a 5-stage write-heavy async route, no auth, no rate limiting, an unauthenticated public endpoint that dumps the (global) watchlist, an in-process module-level cache that breaks under multiple workers, hardcoded `localhost` CORS, and an LLM cost/abuse surface that any anonymous caller can trigger. The engineering _within_ the single-user assumption is strong; the system-level engineering assumes that assumption will never be violated, and a "major public launch" violates it on request #2.

**Verdict: Approve for personal use or a portfolio demo. Do NOT approve for public multi-user launch without a user-identity + data-isolation rebuild.**

# Strengths

These are real and specific — not padding.

1. **The recommendation engine is a legitimate multi-stage system, not a single LLM prompt.** `routers/recommendations.py` cleanly separates facet enrichment (stage 0), weighted taste profiling (stage 1), cached LLM taste reading (stage 2), multi-channel retrieval with round-robin interleaving (stage 3), Taste-DNA vectorization (stage 3.5), deterministic hybrid scoring + bucketing + MMR diversity (stage 4), and LLM explanations (stage 5). Crucially, **ranking was deliberately moved OUT of the LLM into deterministic `scoring.py`** — the LLM only writes prose. That is exactly the right call for reproducibility, cost, and testability, and the docstrings show the author understood _why_.

2. **Pure, dependency-free, well-tested core logic.** `dna.py` and `scoring.py` are pure functions with no I/O, and `tests/unit/` covers them meaningfully: DNA aggregation direction/confidence, distance bounds, bucket assignment, and — notably — the MMR diversity caps (`test_director_cap_enforced`, `test_genre_cap_enforced`, `test_decade_cap_enforced`). The Groq JSON-parsing path is tested with a mocked client for both the happy path and the garbage-response path. This is the discipline of someone who has been burned by flaky LLM output before.

3. **Hallucination-grounding of LLM output.** `_resolve_keyword_ids` / `_resolve_person_ids` take the LLM's free-text keyword/person strings and resolve them against real TMDB ids before they're ever used in a query (`recommendations.py:306-338`). The LLM is treated as an untrusted suggester, not an oracle. This is a mature pattern.

4. **Layered caching with correct invalidation keys.** Facets/DNA/external-ratings are cached forever (or TTL'd) in SQLite; the taste analysis is keyed on an md5 fingerprint of sorted `(tmdb_id, rating)` pairs so the expensive Groq call only fires when ratings actually change (`recommendations.py:721-739`). The OMDb cache (`movies.py`) protects a 1000/day quota with a 14-day TTL and correctly distinguishes "permanent empty" (no IMDb id → cacheable) from "transient failure" (don't cache, serve stale).

5. **Genuinely careful optimistic UI.** Every mutation handler follows snapshot → optimistic update → await → revert-on-catch (`app/page.tsx handleRate`, `watchlist/page.tsx`, etc.). The "Not Interested" flow uses a **deferred-persist undo window** (`page.tsx:213-237`) so the feedback POST can't race the Undo, and flushes pending dismissals on unmount. That is a subtle correctness concern handled correctly.

6. **Race-guarded data fetching.** `search/page.tsx` keys its fetch effect on the URL, guards stale responses with `fetchKeyRef`, and refuses to load page 2 before page 1 of the current query resolves (`readyKeyRef`, line 341). Infinite scroll uses an `IntersectionObserver` with a busy-ref guard. These are the exact bugs most apps ship with; here they're addressed.

7. **Accessibility was treated as a feature, not an afterthought.** Modal focus trap with correct first/last Tab handling and `aria-hidden` on background `main`/`nav` (`MovieModal.tsx:46-90`), `role="status"` toasts that pause on hover/focus so AT users can reach Undo, `aria-pressed` on toggles, 44px touch targets. The QA-FINDINGS doc with a resolution log shows this was systematic.

8. **Secrets hygiene is correct for the repo.** `git ls-files` confirms only `.env.example` and `frontend/.env.local.example` are tracked; real `.env` and `movie_night.db` are gitignored and untracked. Keys are read from env via `python-dotenv`. This is done right.

# Critical Findings

### C1 — No user identity: all data is global and shared across every visitor
**Files:** `models.py` (all tables), `routers/ratings.py`, `routers/watchlist.py`, `routers/recommendations.py`, `TasteProfile.user_id` default `"local"`.
**Problem:** There is no `User` table, no session, no auth, no `user_id` foreign key on `Rating`/`WatchlistItem`/`RecFeedback`/`RecEvent`. `TasteProfile` hardcodes `user_id="local"`. `db.query(Rating).all()` returns _every_ rating in the database to _every_ caller.
**Why it matters:** The app is described as MVP pushed to GitHub with a public-facing share page. The instant two people use a deployed instance, they write into one shared taste profile, see one shared watchlist, and corrupt each other's recommendations. There is no isolation boundary anywhere.
**Impact:** Data-model invalidation, privacy breach, and nonsensical recommendations the moment the app is multi-tenant. This is the single biggest blocker.
**Severity:** Critical.
**Recommendation:** Introduce identity before any public launch. Minimum viable: a `users` table + signed session cookie (or a `device_id` claim), add `user_id` (indexed, FK) to `ratings`, `watchlist`, `rec_feedback`, `rec_events`, make `taste_profile`/`taste_analysis` keyed on `user_id`, and scope every query with `.filter(...user_id == current_user)`. This is a rebuild of the persistence layer, not a patch — plan for it accordingly.

### C2 — `/watchlist/share` exposes the global watchlist to anyone, unauthenticated
**Files:** `routers/watchlist.py:125-127`, `frontend/app/share/page.tsx`.
**Problem:** `GET /watchlist/share` returns the entire `WatchlistItem` table with no auth, no token, no per-list scoping. Combined with C1, "share my list" is "share _everyone's_ list."
**Why it matters:** It is presented as a shareable public link. Once multi-user, it leaks every user's viewing data. Even single-user, it's an open endpoint exposing personal data to the internet.
**Impact:** Privacy leak; trivially scraped.
**Severity:** Critical (multi-user) / High (single-user public deploy).
**Recommendation:** Share links must be capability URLs — generate an opaque unguessable `share_token` per user, and serve `/watchlist/share/{token}` scoped to that token's owner. Never serve "all rows."

### C3 — No rate limiting on LLM-triggering endpoints → unbounded cost / DoS
**Files:** `routers/recommendations.py` (route `GET /recommendations`), `dna.py`, `_groq_taste_analysis`, `_groq_explain`.
**Problem:** `GET /recommendations` is unauthenticated and, on a ratings change or cache miss, fires up to three categories of Groq calls (taste analysis, up to `DNA_BATCH_LIMIT=8` DNA scorings, one explanation call) plus up to ~15 TMDB enrichment fetches and ~8 discover/keyword/person calls. There is no per-IP rate limit, no request quota, no auth gate. The `refresh` query param explicitly _bypasses the cache_ (`refresh != 0` skips the `_cache` lookup and re-seeds).
**Why it matters:** An anonymous attacker can loop `?refresh=1,2,3,...` and burn the entire Groq 100K-token/day budget (the README admits ~3-4K tokens/request) and hammer TMDB/OMDb quotas in minutes — denying service to legitimate users and potentially incurring cost.
**Impact:** Quota exhaustion, DoS, cost amplification.
**Severity:** Critical for public launch.
**Recommendation:** Put the LLM-triggering routes behind auth (C1) and add per-user/per-IP rate limiting (e.g. `slowapi`/Redis token bucket). Cap `refresh` server-side. Track per-user daily LLM spend and degrade to the deterministic fallback when exceeded (the fallback already exists — wire a budget guard to it).

### C4 — SQLite + global mutable in-process cache will not survive multi-worker production
**Files:** `database.py:6` (`check_same_thread=False`, file SQLite), `recommendations.py:76` (`_cache`, `_keyword_id_cache`, `_person_id_cache` module-level dicts), the write-heavy `GET /recommendations` route.
**Problem:** (a) SQLite is a single-writer embedded DB; the recommendations route does many writes per request (facets, DNA upserts, `RecFeedback`/`RecEvent` impression logs, profile persist, plus delete-sweeps). Under concurrent load you'll hit `database is locked`. (b) The response cache and id caches are **module-level Python dicts** — under the normal production deployment (Gunicorn/Uvicorn with N workers) each worker has its own copy, so cache hit rates collapse and behavior becomes nondeterministic across workers. (c) These dicts are also unbounded — `_keyword_id_cache`/`_person_id_cache`/`_cache` grow without eviction (only `_cache` has a TTL check on read, but entries are never purged).
**Why it matters:** The entire design assumes one process, one writer, one user. None of those hold in production.
**Impact:** Lock contention/500s under concurrency; cache incoherence; slow memory growth.
**Severity:** Critical for scale.
**Recommendation:** Move to Postgres for any multi-user deploy. Move the response cache to Redis (shared, with TTL + eviction). Make the recommendations route do far fewer writes per request (see H-series). If staying single-process for a demo, document it loudly.

### C5 — A `GET` endpoint performs heavy writes and DB sweeps
**Files:** `routers/recommendations.py:842-861`.
**Problem:** `GET /recommendations` writes `RecFeedback("shown")` + `RecEvent("impression")` rows for all 12 picks, upserts `MovieDNA`, persists `TasteProfile`, and runs two `DELETE` sweeps (14-day feedback, 90-day events) — all on a GET.
**Why it matters:** GETs are assumed safe/idempotent/cacheable by browsers, proxies, prefetchers, and crawlers. A bot prefetching this URL mutates state and triggers DELETE sweeps. It also makes the route non-idempotent and CDN-uncacheable.
**Impact:** Surprising side effects, write amplification on every page load/prefetch, no clean caching story.
**Severity:** Critical (correctness/REST-semantics) — High if you consider it "just works today."
**Recommendation:** Split it: `GET /recommendations` returns picks (read-only, cacheable); impression logging becomes a separate `POST /events` (the client already has `logEvent`). Run the TTL sweeps in a scheduled job/cron, not inline on user requests.

# High Priority Findings

### H1 — Recommendations route is a 190-line god-function with no service layer
**Files:** `recommendations.py:683-874` (`get_recommendations`).
**Problem:** The route handler orchestrates all 5 stages, profile fingerprinting, cache lookup, candidate retrieval, DNA aggregation, scoring, bucketing, explanation, impression logging, and TTL cleanup. There is no service/repository layer — DB queries, business logic, TMDB I/O, and HTTP concerns are interleaved in the router.
**Why it matters:** It's nearly impossible to unit-test the orchestration (the tests only cover the extracted pure helpers), hard to reuse, and every change risks the whole pipeline. Compare to the clean separation in `dna.py`/`scoring.py` — the engine _is_ refactored, but its driver is not.
**Impact:** High change-risk, untestable orchestration, slow onboarding.
**Severity:** High.
**Recommendation:** Extract a `RecommendationService` (or module-level `build_recommendations(db, user, params)`) that returns the payload; keep the router thin. Split candidate retrieval, scoring, and serving into separate testable units.

### H2 — Per-request `httpx.AsyncClient()` churn instead of a shared pooled client
**Files:** `recommendations.py:121, 397`, `movies.py:39, 181`.
**Problem:** Almost every TMDB/OMDb call opens a fresh `async with httpx.AsyncClient()`. `movies.py._tmdb_get` opens a new client per call. This discards connection pooling and TLS session reuse and adds latency per call.
**Why it matters:** TMDB calls dominate latency; the recommendations route makes dozens. Creating clients per call is measurable overhead and limits keep-alive benefits.
**Impact:** Higher p95 latency, more sockets.
**Severity:** High.
**Recommendation:** Create one app-lifetime `httpx.AsyncClient` (with sane `limits`/`timeout`) in lifespan and inject it. Centralize TMDB access in one client module (also removes the duplicate `_tmdb_get` defined in both routers).

### H3 — N+1 / unbatched OMDb fetches each do a TMDB round-trip first
**Files:** `movies.py:166-200` (`_fetch_omdb_ratings`).
**Problem:** For each cache-miss movie, the batch ratings endpoint calls `_tmdb_get(/movie/{id})` _just to get `imdb_id`_, then calls OMDb. So a 20-movie batch miss = 20 TMDB calls + 20 OMDb calls, fanned out with a semaphore of 5.
**Why it matters:** The `imdb_id` is already available from the `/movie/{id}` enrichment the recommendations engine performs and caches in `movie_facets` — but it's not stored there, so it's re-fetched. Pure duplicate work.
**Impact:** Doubled external calls, slower modal/card rating loads, faster quota burn.
**Severity:** High.
**Recommendation:** Persist `imdb_id` during facet enrichment and read it from cache before hitting TMDB again. Better: store `imdb_id` on `MovieFacets`.

### H4 — Blocking/duplicated work and silent exception swallowing
**Files:** `recommendations.py:92` (`except Exception: return {}`), `:734` (`except Exception as e: print(...)`), `dna.py:166` (`json.loads` not guarded against `JSONDecodeError` in `llm_score_dna`).
**Problem:** `_tmdb_get` swallows _all_ exceptions and returns `{}` — a TMDB outage looks identical to "no results," so the engine silently degrades with no signal. Errors are surfaced via `print()`, not a logger. `llm_score_dna` does `json.loads(text[start:end+1])` with no try/except around the parse (the `_groq_*` callers catch at the call site, but `llm_score_dna` itself can raise `JSONDecodeError`, and it's invoked via `asyncio.to_thread` inside a try in `_ensure_dna.upgrade`, so it's caught — but the asymmetry is fragile).
**Why it matters:** Blanket `except Exception` hides bugs and makes outages undiagnosable; `print` is invisible in real deployments.
**Impact:** Undebuggable production failures, silent quality degradation.
**Severity:** High.
**Recommendation:** Use the `logging` module with levels; narrow exception handling to the expected types (`httpx.HTTPError`, `json.JSONDecodeError`); emit metrics/log lines when a channel returns empty so silent degradation is observable.

### H5 — No DB indexes on the columns every query filters by
**Files:** `models.py`. `Rating.tmdb_id` and `WatchlistItem.tmdb_id` are `unique=True` (which implies an index in SQLite), but **`RecFeedback.action`, `RecFeedback.created_at`, `RecEvent.bucket`, and the (future) `user_id` columns are unfiltered-index-wise.** The recommendations route filters `RecFeedback` by `action`/`created_at` in Python after `db.query(RecFeedback).all()` (`:701-707`) — it loads the _entire_ table into memory every request.
**Why it matters:** `feedback = db.query(RecFeedback).all()` then filters in Python is an O(table) scan + full materialization on every recommendation request. `RecEvent` analytics similarly loads everything since a date. As event volume grows this is the first thing that gets slow.
**Impact:** Linear memory + scan growth per request; degrades well before 10K users.
**Severity:** High.
**Recommendation:** Filter in SQL (`.filter(RecFeedback.action == ...)`, date predicates) and add composite indexes (`(user_id, action, created_at)`, `(user_id, event_type, created_at)`). Don't `.all()` whole tables into Python.

### H6 — `useCardRatings` module-level cache is correct-ish but leaks and never invalidates
**Files:** `frontend/lib/ratings.ts:14-37`.
**Problem:** `cache`/`inflight` are module-level `Map`s living for the tab's lifetime. They never evict and never invalidate, so a movie's external ratings are frozen for the session even if the 14-day backend TTL refreshes. Empty `{}` results (failures) are cached permanently for the session, so a transient failure means no scores until reload.
**Why it matters:** Mostly fine for a session, but "cache failure forever" is a footgun, and the unbounded map grows with every movie viewed.
**Impact:** Stale/empty badges after transient errors; minor memory growth.
**Severity:** Medium-High.
**Recommendation:** Don't cache empty results (or cache with a short TTL). Consider a real client cache (React Query/SWR) which gives you dedupe, TTL, and revalidation for free and would replace several hand-rolled patterns.

### H7 — Hardcoded CORS and API base; no config management
**Files:** `main.py:14-20` (`allow_origins=["http://localhost:3000"]`), `database.py:4` (hardcoded SQLite URL), `lib/api.ts:1` (env-driven, good).
**Problem:** CORS origin and DB URL are hardcoded constants. There is no settings object (e.g. `pydantic-settings`). Deploying anywhere requires code edits. `allow_credentials=True` with a fixed origin is okay, but there's no notion of environments.
**Why it matters:** Configuration-as-code blocks clean dev/staging/prod separation and is a classic launch blocker.
**Severity:** High (for launch).
**Recommendation:** Introduce `pydantic-settings` with `DATABASE_URL`, `ALLOWED_ORIGINS`, key presence validation at startup (fail fast if `TMDB_API_KEY` missing rather than returning `{"source":"error"}` per request).

# Medium Priority Findings

### M1 — `rateAndAddWatched` is two sequential non-atomic API calls
**Files:** `lib/api.ts:217-235`. Rating then watchlisting are two awaits; if the second fails the system is half-updated (rating saved, not marked watched) and the optimistic UI revert in callers reverts _both_. The backend has no single endpoint to do this atomically.
**Severity:** Medium. **Fix:** add a backend endpoint that rates + marks watched in one transaction.

### M2 — `Rating.rating` is a free `Float` with no validation
**Files:** `models.py:16`, `ratings.py RatingCreate.rating: float`. Nothing enforces 1–5. A client can POST `rating: 9999` or `-3`, which then flows into `int(r.rating)-3` weights and DNA aggregation, skewing the whole profile.
**Severity:** Medium. **Fix:** Pydantic `Field(ge=1, le=5)` (or `ge=0` for clear), and a DB check constraint.

### M3 — Duplicate constants and logic across layers
The genre map exists in **three** places: `lib/tmdb.ts GENRE_MAP`, `recommendations.py GENRE_MAP`, and provider/genre lists are re-declared in `app/page.tsx`, `app/search/page.tsx`, and `lib/streaming.ts` (provider ids appear in `search/page.tsx PROVIDERS` _and_ `lib/streaming.ts STREAMING_PROVIDERS`). These will drift.
**Severity:** Medium. **Fix:** single source of truth per concern; have the backend expose `/config` (genres, providers) or share a generated constants file.

### M4 — `_jitter` and seed coupling make "refresh" semi-deterministic in a way that can repeat
**Files:** `scoring.py:45`, `recommendations.py:352` (`page = (seed % 8) + 1`), `:752` (`seed = refresh*7919+17`). Refresh cycles through only 8 TMDB pages; a heavy user who refreshes >8 times will start re-seeing pages. The "wildcard"/novelty story degrades for power users.
**Severity:** Medium. **Fix:** widen the page window, track served ids more aggressively (already partially done via `recently_shown`), and/or sample pages by hashing seed over a larger space.

### M5 — Recommendation cold-start and thin-profile quality
With few ratings, `confidence` is near zero (`aggregate_profile_dna` `data_factor = total_w/6`), so `blend = 0.6` leans on baseline quality/discovery — reasonable. But the proxy DNA is coarse (genre/keyword nudges), and until `DNA_BATCH_LIMIT=8` LLM upgrades drain over many requests, most candidate vectors are `proxy-transient` with empty themes. Theme affinity (`W_THEME=0.14`) therefore does little for new candidates. Recommendations will feel genre-driven, not taste-driven, for a while.
**Severity:** Medium. **Fix:** acknowledge it as a product limitation; consider precomputing DNA for a popular-movie seed set offline.

### M6 — `MovieModal` re-fetches detail/providers/ratings on every open; no shared cache
**Files:** `MovieModal.tsx:39-42`. Opening the same movie twice re-hits 3 endpoints. The card already has `vote_average`, title, year — the modal could hydrate from props while detail loads.
**Severity:** Medium. **Fix:** pass known fields as initial state; cache detail responses (React Query).

### M7 — Frontend has zero automated tests
There are no component tests, no Playwright/Cypress e2e, no tests for the intricate optimistic-UI/undo/race logic that is the frontend's main risk surface. The backend pure logic is tested; the most bug-prone frontend flows are not.
**Severity:** Medium. **Fix:** add Vitest + Testing Library for `useCardRatings`, the undo flow, and the search race guards; one Playwright smoke test for rate → recommend → watchlist.

### M8 — `init_db()` only `create_all`, never migrates; schema changes are silent no-ops
**Files:** `database.py:19-21`, and CLAUDE.md confirms "never ALTERs existing ones." Adding a column to an existing table requires manually dropping the DB. There is no Alembic.
**Severity:** Medium. **Fix:** adopt Alembic before the schema stabilizes — adding `user_id` (C1) will force this anyway.

### M9 — Inline styles everywhere; `globals.css` is 649 lines of hand-rolled CSS
Pages use large inline `style={{...}}` objects (e.g. `app/page.tsx` onboarding block, every card). This defeats Tailwind's value, bloats the JS bundle slightly, prevents reuse, and makes the design system inconsistent (some tokens via CSS vars, some literal hex like `#d4d4d8`, `#e4e4e7` in `MovieCard`/`MovieModal`).
**Severity:** Medium. **Fix:** move repeated inline styles into CSS classes/components; ban literal colors in favor of tokens.

# Low Priority Findings

- **L1 — `@app.on_event("startup")` is deprecated** in current FastAPI/Starlette (`main.py:23`). Use the `lifespan` context manager.
- **L2 — `datetime.utcnow()` used throughout** (`recommendations.py`, `movies.py`, `analytics.py`) — deprecated in Python 3.12+ and naive. Watchlist uses `datetime.now(timezone.utc)` (aware). Inconsistent; standardize on timezone-aware UTC.
- **L3 — `movies.py` defines its own `tmdb_key()` and `_tmdb_get`** separate from `recommendations.py`'s versions — duplicate HTTP plumbing.
- **L4 — `events.py log_event` returns 400 on unknown type but the client fires-and-forgets** and ignores the response (`api.ts logEvent` `.catch(()=>{})`), so validation errors are invisible. Fine, but the strictness buys nothing.
- **L5 — `Counter` typed as `Counter` (untyped) in `_build_profile`** and several `dict` annotations are loose; `mypy --strict` would flag many. No type-checking in CI.
- **L6 — `share/page.tsx` `getWatchlist()` has no `.catch`** on the error path beyond `.finally` — a backend down leaves a permanent "Loading…" replaced by empty with no error message.
- **L7 — `"★".repeat(item.post_watch_rating)`** in `share/page.tsx:111` assumes an integer 1–5; a fractional or out-of-range rating (see M2) breaks the display.
- **L8 — No request size / pagination caps on `getRatings`/`getWatchlist`** — they `.all()` and serialize everything; fine at hobby scale, unbounded otherwise.
- **L9 — `.coverage` file is gitignored but present in the tree**; harmless, just noise.
- **L10 — The AI explanation prompt embeds user data (`_profile_text`) and movie overviews into the LLM context** — low prompt-injection risk today (output is one sentence, not executed), but a movie overview containing instructions could nudge the explanation text. Worth noting for an "assume malicious" review; impact is cosmetic.

# Refactoring Roadmap

Ranked highest-ROI → lowest. The first three are launch-gating; the rest are quality/scale.

1. **Introduce user identity + data isolation (C1, C2).** Users table, session/cookie or device id, `user_id` (indexed FK) on ratings/watchlist/feedback/events, scope every query, capability-token share links. This unblocks every other multi-user concern. _Highest ROI — nothing else matters for public launch until this exists._
2. **Gate + rate-limit + budget the LLM/TMDB routes (C3).** Auth on `/recommendations`, per-user/IP rate limit, server-side `refresh` cap, daily LLM budget guard wired to the existing deterministic fallback.
3. **Make `GET /recommendations` read-only; move writes/sweeps out (C5).** Impressions → `POST /events`; TTL sweeps → cron job. Restores REST semantics and CDN-cacheability.
4. **Extract a `RecommendationService`; thin the router (H1).** Makes the orchestration testable and reusable.
5. **Migrate SQLite → Postgres + Redis cache; shared pooled `httpx` client (C4, H2).** Removes lock contention, fixes multi-worker cache incoherence, cuts latency.
6. **Push filters into SQL + add indexes; stop `.all()`-ing whole tables (H5).** Fixes the first thing that gets slow.
7. **Persist `imdb_id` in facets to kill the duplicate TMDB fetch in OMDb path (H3).** Cheap, halves external calls on ratings loads.
8. **Config management (pydantic-settings) + fail-fast key validation + lifespan (H7, L1).**
9. **Logging instead of `print`/swallowed exceptions; structured error signals (H4).**
10. **Frontend: adopt React Query/SWR (replaces `useCardRatings`, modal refetch, search fetch plumbing) + add Vitest/Playwright (H6, M6, M7).** De-risks the most bug-prone layer and deletes hand-rolled cache code.
11. **Single-source constants (genres/providers) via a `/config` endpoint (M3).**
12. **Alembic migrations; validation on `rating` (M2, M8).**
13. **Design-system cleanup: kill inline styles/literal colors (M9).**

# Production Readiness Score

| Dimension | Score | One-line justification |
|---|---|---|
| Architecture | 5/10 | Engine is well-layered, but no user/identity boundary and a god-route driving it; business logic lives in the router. |
| Backend | 5/10 | Clean routers and good caching, but write-on-GET, swallowed exceptions, per-call httpx clients, no service layer. |
| Frontend | 7/10 | Genuinely careful optimistic UI, race guards, and a11y; held back by inline-style sprawl, duplicated constants, and zero tests. |
| Database | 3/10 | No user scoping, no indexes on filtered columns, whole-table `.all()` scans, SQLite single-writer, no migrations. |
| Security | 2/10 | No auth, no rate limiting, public global share endpoint, unbounded LLM cost surface; secrets hygiene is the lone bright spot. |
| Testing | 5/10 | Excellent pure-logic backend coverage; nothing for the orchestration route or any of the frontend. |
| Performance | 5/10 | Smart caching offsets it, but dozens of fresh-client TMDB calls/request, duplicate fetches, and in-Python table scans. |
| Maintainability | 6/10 | Strong docstrings, pure modules, and clear intent; undercut by a 190-line route, triple-declared constants, and inline styles. |
| Scalability | 2/10 | Module-global caches + SQLite + global data model break at the 2nd concurrent user / 2nd worker. |
| Developer Experience | 7/10 | `start.sh`, clear CLAUDE.md, pytest config, `.env.example`, planning docs — easy to run and reason about locally. |

# Staff Engineer Standards

**1. Would you approve this codebase for production?**
**No** — not for the "major public multi-user launch" the prompt specifies. I would approve it as a **single-user personal app or portfolio demo today.** The blockers are categorical (no identity, no auth, no rate limiting, global shared data), not cosmetic. For a personal deploy behind a single login, it's already enjoyable and largely correct.

**2. Top 10 risks**
1. Global shared data with no user isolation (C1) — corrupts data + leaks privacy at user #2.
2. Unauthenticated public `/watchlist/share` dumping all rows (C2).
3. Unbounded LLM/TMDB cost via unauth, cache-bypassing `?refresh` (C3).
4. SQLite single-writer + write-heavy GET → `database is locked` under load (C4/C5).
5. Module-global caches incoherent across workers; unbounded growth (C4).
6. Whole-table `.all()` + in-Python filtering on every rec request (H5).
7. Swallowed exceptions + `print` logging → undiagnosable outages, silent quality decay (H4).
8. No migrations; schema evolution requires dropping the DB (M8).
9. No input validation on `rating` → profile poisoning (M2).
10. Zero frontend tests over the most bug-prone (optimistic/undo/race) code (M7).

**3. Top 10 refactors** — see Refactoring Roadmap items 1–10 (user identity → rate-limit/budget → read-only GET → service extraction → Postgres/Redis/pooled httpx → SQL filtering+indexes → imdb_id caching → config mgmt → logging → React Query + tests).

**4. What blocks launch?**
User identity + data isolation (C1), share-link scoping (C2), auth + rate limiting + LLM budget on the rec route (C3), making `GET /recommendations` non-mutating (C5), and config/CORS for real environments (H7). Until C1–C3 are done, a public launch is unsafe regardless of polish.

**5. What becomes painful in 6 months?**
The 190-line god-route (H1) makes every engine tweak risky and untestable. Triple-declared genre/provider constants (M3) drift and cause silent UI/engine mismatches. No migrations (M8) makes every schema change a manual DB-drop. Inline-style sprawl (M9) makes design changes a find-and-replace slog. The session-permanent `useCardRatings` cache (H6) produces "why are my scores stale/blank" bug reports.

**6. What becomes painful at 100x scale?**
- **100 users:** SQLite write contention on the multi-write GET (C4/C5); shared global data is already nonsensical (C1).
- **10,000 users:** whole-table scans (`RecFeedback.all()`, `RecEvent` since-date in Python) dominate latency (H5); module-global caches across workers waste compute; LLM cost is unbounded (C3).
- **1,000,000 users:** SQLite is long gone; you need Postgres + partitioned/retention-managed event tables, a real candidate-gen/feature store offline, a shared cache tier, async LLM/enrichment workers off the request path, and per-user budget accounting. The current synchronous, in-request enrichment+scoring+LLM model cannot hold.

**7. What demonstrates strong engineering?**
The deliberate decision to move ranking out of the LLM into deterministic, unit-tested `scoring.py`; grounding LLM strings against real TMDB ids; fingerprint-keyed cache invalidation for the expensive taste call; the layered SQLite enrichment caches with correct transient-vs-permanent failure handling; the deferred-persist undo window and search race-guards; and the systematic accessibility (focus trap, paused toasts, aria states). This is thoughtful, senior-leaning work _within the single-user frame._

**8. What looks junior/mid-level?**
Treating identity/auth/rate-limiting/multi-tenancy as out of scope for something called an "MVP pushed to GitHub" with a public share page; mutating state inside a GET; module-global mutable caches as the caching strategy; `print`/blanket-`except` error handling; `.all()`-then-filter-in-Python; hardcoded CORS/DB URL with no settings layer; no migrations; no input validation on the core `rating` field; and inline-style sprawl that abandons the chosen styling system. These are the gaps between "builds an impressive feature" and "ships a system other people can safely use and operate."

---
kanban-plugin: board
---

> **Decision (2026-06-24): this is a personal, local-only tool — no public deployment.** The whole
> feature set, the learned-ranker engine, group mode, and the entire QA backlog are done. The
> **Launch-Gating (C-tier) is intentionally parked** — multi-user / auth / hosting are not needed for a
> private tool run via `./start.sh`. Anything below is optional, for-fun future work, not owed.

## 🎯 Recommendation Quality — priority order (do top-down)

From the 2026-06-17 multi-agent review board. ⭐ = the "first move" all four reviewers converged on (closes the open feedback loop + makes everything measurable). Doc IDs (Q/M/S) map back to the review.

- [ ] **6 · M3** ❌ _SKIP as a standalone (research 2026-06-19): rated set already 87% LLM-scored; the prescribed fix is measured useless (~0.015 band-aid, DNA is anti-predictive). Fold DNA in as an S1 feature instead._ #rec
- [ ] **9 · Q4** ❌ _SKIP (research 2026-06-19): measured net-NEGATIVE on the eval at every half-life. Ratings were bulk-entered in one week, so `created_at` ≠ viewing chronology — no drift to recover. Revisit only with real multi-month history._ #rec
- [ ] **10 · M4** ⚠️ _Tried + reverted: max-normalizing genre worsened the eval (Pearson −0.28→−0.31). The M5 harness gated it out — real fix is S1 (learned weights), not per-term tweaks._ #rec #backend
- [x] **16 · S1** ✅ **DONE (2026-06-19)** Learned ranker shipped — `backend/features.py` (shared train/serve extractor), `backend/train.py` (numpy Ridge, LOO features, CV alpha, eval-gated), `LearnedModel` table + Alembic migration. **Beat the gate decisively: Pearson −0.1465 → +0.2273, Spearman −0.2389 → +0.2337, NDCG@12 0.6064 → 0.6310** (the hand-tuned signs really were backwards). Active model serving; hand-tuned weights remain the fallback. Absorbed M4 (`genre_affinity_norm`) + M3 (`dna_is_proxy`) as features. #rec #backend #strategic
- [ ] **17 · S2** Offline catalog enrichment + embedding/ANN retrieval (move LLM/embeddings off the hot path) #rec #backend #infra #strategic
- [ ] **18 · S4** Principled exploration — contextual bandit / Thompson sampling (use logged `predicted_score` as propensity) replacing `rng.uniform` jitter #rec #backend #strategic
- [ ] _S3 (multi-user data model + Postgres + Redis) → tracked in **Launch-Gating** as C1/C4. S5 (retention features) → tracked in **Product / UX Backlog**._


## 🚀 Launch-Gating — ⏸️ PARKED BY DECISION (2026-06-24, staying local) · only revisit if going public

- [x] **QA-EB** ✅ **DONE (2026-06-24)** Global error boundaries — `app/error.tsx` (route errors, with Try-again), `app/global-error.tsx` (root-layout errors, self-contained html/body), `app/not-found.tsx` (custom 404). No more white screen on a render crash. #critical #frontend #blocker
- [x] **QA-GB** ✅ **DONE (2026-06-24)** Group endpoint bounded — Pydantic caps (≤10 members, ≤200 ratings/member, ≤50 genre_ids, rating 1–5, name ≤60) → over-limit input rejected with 422; guests with <3 ratings dropped server-side. Closes the `O(candidates × members)` DoS. #critical #backend #blocker
- [ ] **C1** User identity + data isolation: `users` table, session/device id, `user_id` FK on all data, scope every query #critical #backend #db #blocker
- [ ] **C2** Capability-token share links (`/watchlist/share/{token}`), never "all rows" #critical #backend #blocker
- [ ] **C3** Auth + per-IP/user rate limit + daily LLM budget guard on `/recommendations` #critical #backend #blocker
- [ ] **C5** Make `GET /recommendations` read-only; move impression writes to `POST /events`, TTL sweeps to cron #critical #backend
- [ ] **C4** Migrate SQLite → Postgres + Redis for the shared cache (multi-worker safe) #critical #db #infra


## 🔍 QA Review Board findings (2026-06-24) — see `Improvement_plans/2026-06-24-QA-REVIEW-BOARD.md`

P1 (fix soon):
- [x] **QA-EXPL** ✅ **DONE (2026-06-24)** Template explanations now key on the **strongest concrete match** (`_matched_signal`: loved director → actor → theme → genre → DNA/anchor) with deterministic phrasing variants — so the Groq-down fallback no longer shows twelve identical "fast-paced, emotional feel of X" lines. Applies to both single-user + group. #rec #backend #p1
- [x] **QA-TIMEOUT** ✅ **DONE (2026-06-24)** `req()` now wraps every fetch in an `AbortController` with a 30s timeout → a hung TMDB/Groq call aborts with a clear "taking longer than usual" error instead of spinning forever. #frontend #reliability #p1
- [x] **QA-WLVIRT** ✅ **DONE (2026-06-24)** Watchlist: in-list **🔍 search** (filters by title, shown past 8 items) + render cap of 48 cards with a **"Show more"** button — no longer renders 100+ cards (and their meta/score fetches) at once. #frontend #perf #p1
- [x] **QA-OBS** ✅ **DONE (2026-06-24)** Structured per-request log line from the engine: `rec served cache=hit|miss ms=… source=ai|tmdb pool=… picks=… cold_start=… model=…` — surfaces latency, prose source (Groq up vs template), candidate-pool size, and learned-model status. (Full metrics/dashboards still want Postgres+infra later.) #backend #infra #p1
- [x] **QA-E2E** ✅ **DONE (2026-06-24)** Playwright harness (`frontend/playwright.config.ts` + `e2e/smoke.spec.ts`, `npm run test:e2e`): every primary route renders without the error boundary, the ⌘K palette opens, and an unknown route shows the custom 404. **3 passing.** Catches the white-screen class. #test #p1

P2 (improvements):
- [x] **QA-FRESH** ✅ **DONE (2026-06-24)** `_ensure_recency` guarantees ≥1 pick from the last 4 years (swaps the lowest-scoring old pick for the best recent candidate) — verified a 2023 film now surfaces where the set was previously all pre-2002. Applies to For You + group. #rec #p2
- [x] **QA-TONIGHT** ✅ **DONE (2026-06-24)** Watchlist **🍿 Tonight** button — one tap picks the best *unwatched* movie that's ≤2h and (if you've set services) streamable on them, ranked by score, and opens it. The "stop scrolling, just tell me" shortcut. #frontend #product #p2
- [x] **QA-FATIGUE** ✅ **DONE (2026-06-24)** For You leads with mood pills + picks; the 12 genre chips and the streaming-service filter now collapse behind a single **⚙ Refine** toggle (which surfaces any active filter so it's never hidden). Much less always-on control density. _(Discover drawer left as-is — already gated behind a drawer.)_ #ux #p2
- [x] **QA-GUESTFI** ✅ **DONE (2026-06-24)** `guest_profile` now upgrades guests to **people + theme affinity** (not just genre+proxy) using cached facets of their rated movies — the group builder enriches guest-rated ids via `_ensure_facets` and passes them in. Degrades to genre+proxy when facets absent. #rec #p2
- [x] **QA-ANCHOR** ✅ **DONE (2026-06-24)** `_diversify_anchors` reassigns "Inspired by X" across the final picks with a usage penalty so the same favorite isn't named repeatedly — verified 12 distinct anchors of 12 (was repeating). Applies to For You + group. #rec #p2


## 🛠️ Engineering Backlog (secondary — lower value than Rec Quality)

- [ ] **CFG** `/config` endpoint (genres + providers) → kills the last cross-layer constant drift #medium #backend #frontend
- [ ] **E2E** One Playwright smoke test: rate → recommend → watchlist #medium #frontend #test
- [ ] **M9b** Broader inline-`style` → CSS-class migration (literal-hex slice already done) #medium #frontend
- [ ] **OBS** Observability: structured logs + basic metrics (rec latency, LLM spend, channel-empty rate) #low #backend
- [ ] **L5** Type-checking + a CI pipeline (mypy backend, tsc/lint/tests in CI) #low #infra
- [ ] **TMDB-MERGE** Merge the two `_tmdb_get` helpers into one `tmdb` client module #low #backend


## 💡 Product / UX Backlog

- [x] **UX1** ✅ **DONE (2026-06-19)** Global **⌘K / Ctrl-K** command palette (`CommandPalette`, mounted in layout) — debounced search across movies + people, ↑↓/↵ keyboard nav, jumps to Discover (title query or person pivot). Also opens via a 🔍 ⌘K button in the nav (touch-friendly). #ux #frontend
- [x] **UX2** ✅ **DONE (2026-06-19)** Card grids are keyboard-navigable — cards are focusable (`role=button`, `tabIndex=0`), Enter/Space opens, and a reusable `gridArrowNav` (`lib/gridNav.ts`) does arrow-key roving (Left/Right by one, Up/Down by a row) on For You + Discover. #ux #a11y #frontend
- [x] **UX3** ✅ **DONE (2026-06-19)** For You cards have a "Why this pick? ▾" toggle that unclamps the explanation and reveals the bucket + bucket-reason + anchor inline (the bucket reason was previously a desktop-only hover tooltip → now mobile-accessible). `aria-expanded`. #ux #frontend
- [x] **UX4** ✅ **DONE (2026-06-19)** New `/settings` page (+ Nav link) with a default streaming-services picker (shared `lib/streaming` set used by For You + Watchlist filters). #ux #frontend
- [x] **UX5** ✅ **DONE (2026-06-19)** `/settings` also lists your "Not interested" movies with one-tap **Restore** (reuses `GET`/`DELETE /rec_feedback`). Backend now **decays exclusions**: `DISMISS_EXCLUDE_DAYS=90` — a dismissed movie is hard-excluded for 90 days then can resurface. #ux #backend #frontend
- [x] **UX6** ✅ **DONE (2026-06-19)** Empty watchlist now leads with "✨ See your For You picks" (→ `/`) alongside Browse Movies. #ux #frontend
- [x] **UX7** ✅ **DONE (2026-06-19)** Global stacking toast queue (`ToastProvider` + `useToast()` in the layout) replaces the per-page single toast. Each toast has its own timer + Undo closure, so several recent actions (e.g. dismissing/removing multiple movies) are **independently undoable**. Migrated For You / Discover / Watchlist / Ratings / Settings / Modal; deleted the old `Toast.tsx`. #ux #frontend
- [x] **UX8** ✅ **DONE (2026-06-19)** Light theme via a `[data-theme="light"]` token override + a Dark/Light toggle on `/settings` (persisted in localStorage, applied pre-paint by an inline script in the layout → no flash). Tokenized the last hardcoded surfaces (nav bg, skeleton, select). #ux #frontend
- [x] **UX9** ✅ **DONE (2026-06-19)** Real content now fades in (`.content-fade-in`) when it replaces the skeleton on For You + Discover — no hard swap. Respects `prefers-reduced-motion`. #ux #frontend
- [x] **UX10** ✅ **DONE (2026-06-19)** Per-page tab titles via a `useDocumentTitle` hook (pages are client components, so this is the metadata-equivalent) on every page (For You / Discover / Watchlist / My Ratings / Taste DNA / Shared). #ux #frontend
- [x] **UX11** ✅ **DONE (2026-06-19)** When the engine returns < its 12-pick target (pool thinning, not cold-start/filtered), For You shows an honest "You've seen most of your best matches — rate more / check back" note + a Rate-more CTA. #ux #frontend
- [x] **UX12** ✅ **DECIDED (2026-06-19): keep coupled** — rating a movie implies you've seen it, so it stays filed as watched (the engine's watched signal depends on this). Working as intended, not a bug. #ux #product
- [x] **UX13** ✅ **CLOSED (2026-06-19)** — was contingent on decoupling (UX12). With coupling kept, rate/remove/undo already round-trips through the same Rating+watchlist write path; no separate symmetry fix needed. Revisit only if a concrete desync is observed. #ux #backend
- [x] **UX14** ✅ **DONE (2026-06-19)** Onboarding CTA now deep-links to `/search?nudge=rate`; Discover shows a dismissible "rate films you've already seen" banner when that param is present. #ux #frontend
- [x] **UX15** ✅ **DONE (2026-06-19)** N/A by design — all chip rows use `flex-wrap`, so no chips are ever hidden off-screen (nothing to scroll to). Added a reusable `.scroll-fade-x` utility (right-edge fade) for any future single-line scroll row. #ux #a11y #frontend
- [ ] **UX16** Weekly "Movie Night Picks" digest + email/notification (the weekly-return hook) #ux #retention
- [ ] **UX17** Watchlist streaming-availability alerts — "now on Netflix" #ux #retention
- [x] **UX18** ✅ **DONE (2026-06-19)** Taste Profile page (`/taste`) — SVG radar of the 10 bipolar DNA axes (bipolar: center=neg pole, edge=pos pole, dashed mid-ring=neutral; dot size = per-axis confidence) + precise diverging-bar breakdown + top genres/people/themes. New `GET /taste` endpoint (`routers/taste.py`) surfaces the persisted `taste_profile`. Nav link added. _(Editable taste controls deferred — read-only v1.)_ #ux #frontend
- [x] **UX19** ✅ **DONE (2026-06-21)** Group "Movie Night" mode — `/group` page: add in-session guests (name + quick-rate ~5 trending films via stars, persisted in localStorage), then `POST /recommendations/group` blends host + guests with a **least-misery + average** objective (`backend/group.py`) so the pick is one nobody hates. Per-pick **member-fit chips** ("You: loves it · Alex: likes it"). Reuses the whole engine (parallel builder, single-user path untouched). Nav link added. Unit-tested (`test_group.py`). Scoped in `Improvement_plans/2026-06-21-GROUP-MOVIE-NIGHT-PLAN.md`. #ux #product


## 🧊 Deferred (parked, with reason)

- [ ] **M5-audit** Cold-start DNA quality — needs offline precompute of a popular-movie seed set (infra, not a code fix) #medium #infra
- [ ] **M6-audit** Hydrate `MovieModal` from props — cosmetic over the existing skeleton; bundle with a client data-layer (React Query) #medium #frontend
- [ ] **L2** Timezone-aware UTC — no impact on Python 3.9, and naive→aware would break SQLite datetime comparisons; do it with Postgres (C4) #low #backend
- [ ] **DATA-LAYER** Adopt React Query/SWR — would replace `useCardRatings`, modal refetch, search fetch plumbing; do once the patterns stabilize #frontend


## ✅ Done (2026-06-17)

- [x] **Q1 (rec #1)** Fold watched + `post_watch_rating` into the taste profile, DNA aggregate, and rating fingerprint — watchlist-page ratings now count #rec #backend
- [x] **Q2 (rec #2)** "Not interested" is now negative taste — penalizes the dismissed movie's themes + pushes the Taste-DNA away (recent 25, decaying); removed the dead `not_interested_titles` #rec #backend
- [x] **M5 (rec #3)** Offline eval harness `backend/eval.py` (CLI + `GET /analytics/eval`) — time-split, NDCG@k + Pearson/Spearman + calibrated RMSE; 12 unit tests. **Baseline: Pearson −0.28, NDCG@12 0.47.** #rec #backend #test
- [x] **M1 (rec #4)** Behavioral signal — clicks + trailer-views on unrated movies feed taste (profile + DNA), bounded/decaying. Loop closed: ratings + watchlist + dismiss + engagement all teach. (Live metric: CTR via `/analytics`, not offline eval.) #rec #backend
- [x] **Q3 (rec #8)** `recently_shown` rotation penalty now applied in `score_candidate` (the final ranking), not just the discarded candidate score #rec #backend
- [x] **Q5 (rec #5)** Cold-start path — <4 signals injects a trending channel + an honest "rate N more" banner; taste `confidence` (0..1) surfaced. New users get good picks, not niche noise #rec #backend #frontend
- [x] **Q6 (rec #14)** Response cache now busts on ratings/watchlist/dismissal changes (not just the dismissal count) — no more stale recs after watchlisting #rec #backend
- [x] **M8 (rec #15)** `TasteProfileSnapshot` table + timeline (`GET /analytics/taste-history`) — appends on profile change, keeps last 60. Taste-evolution + drift signal #rec #backend #db
- [x] **M6 (rec #13)** `movie_dna.model_version` — bump `DNA_MODEL_VERSION` to auto-invalidate stale vectors; existing 529 rows backfilled to v1 (no needless re-score) #rec #backend #db
- [x] **ALEMBIC (rec #12)** Adopted Alembic — `backend/alembic/`, env wired to app settings/metadata, batch mode for SQLite, empty baseline stamped on the live DB (154 ratings intact). Future schema changes go through migrations #db #infra
- [x] **M7 (rec #11)** Fit-floor on discovery buckets — a "Hidden Gem/Underseen/Wildcard" must score ≥80% of the top pick to claim a reserved slot; ends the rigid quota forcing in weak picks #rec #backend
- [x] **M2 (rec #7, partial)** Candidate pool 36 → 60 (free, via dedup) so buckets/MMR have real choices. _The DNA nearest-neighbor channel needs a precomputed catalog → tracked under S2._ #rec #backend
- [x] **M2** Rating 1–5 validation (Pydantic + DB check) #backend
- [x] **H3** Cache `imdb_id` on `MovieFacets` → no duplicate TMDB fetch in OMDb path #backend
- [x] **H5** Filter `RecFeedback` in SQL + composite indexes (no whole-table scans) #backend #db
- [x] **H4** `logging` module + narrowed excepts (no more silent `print`/swallow) #backend
- [x] **H7/L1** `pydantic-settings` config (`DATABASE_URL`/`ALLOWED_ORIGINS`, fail-fast TMDB key) + `lifespan` #backend
- [x] **H1** Extract `build_recommendations()` service; thin route #backend
- [x] **H2** Shared pooled `httpx` client (lifespan-managed) #backend
- [x] **H6** TTL'd `useCardRatings` cache (retries failures, never clobbers good data) #frontend
- [x] **M1-audit** Atomic `POST /ratings/rate-and-watch` #backend #frontend
- [x] **M3-audit** Single-source provider list (Discover imports `STREAMING_PROVIDERS`) #frontend
- [x] **M4-audit** Widen refresh page window (`%8` → `%20`) #backend
- [x] **M7-audit** Vitest + Testing Library set up; 13 tests (ratings cache, providers, tmdb) #frontend #test
- [x] **M9a** Tokenized literal hex (`--text-bright`) #frontend
- [x] **M8a** Minimal idempotent SQLite migration in `init_db()` #backend #db
- [x] **L3a** Shared HTTP transport across routers #backend
- [x] **L6** Share-page error state #frontend
- [x] **L7** Defensive star-repeat clamp #frontend
- [x] **L8** Pagination caps on `/ratings` + `/watchlist` #backend
- [x] **L9** Removed stray `.coverage` #infra
- [x] **L10** Prompt-injection guard in the explanation prompt #backend


%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[false,false,false,false,false,true]}
```
%%

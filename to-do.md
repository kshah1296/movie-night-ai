---
kanban-plugin: board
---

## 🎯 Recommendation Quality — priority order (do top-down)

From the 2026-06-17 multi-agent review board. ⭐ = the "first move" all four reviewers converged on (closes the open feedback loop + makes everything measurable). Doc IDs (Q/M/S) map back to the review.

- [ ] **6 · M3** ❌ _SKIP as a standalone (research 2026-06-19): rated set already 87% LLM-scored; the prescribed fix is measured useless (~0.015 band-aid, DNA is anti-predictive). Fold DNA in as an S1 feature instead._ #rec
- [ ] **9 · Q4** ❌ _SKIP (research 2026-06-19): measured net-NEGATIVE on the eval at every half-life. Ratings were bulk-entered in one week, so `created_at` ≠ viewing chronology — no drift to recover. Revisit only with real multi-month history._ #rec
- [ ] **10 · M4** ⚠️ _Tried + reverted: max-normalizing genre worsened the eval (Pearson −0.28→−0.31). The M5 harness gated it out — real fix is S1 (learned weights), not per-term tweaks._ #rec #backend
- [x] **16 · S1** ✅ **DONE (2026-06-19)** Learned ranker shipped — `backend/features.py` (shared train/serve extractor), `backend/train.py` (numpy Ridge, LOO features, CV alpha, eval-gated), `LearnedModel` table + Alembic migration. **Beat the gate decisively: Pearson −0.1465 → +0.2273, Spearman −0.2389 → +0.2337, NDCG@12 0.6064 → 0.6310** (the hand-tuned signs really were backwards). Active model serving; hand-tuned weights remain the fallback. Absorbed M4 (`genre_affinity_norm`) + M3 (`dna_is_proxy`) as features. #rec #backend #strategic
- [ ] **17 · S2** Offline catalog enrichment + embedding/ANN retrieval (move LLM/embeddings off the hot path) #rec #backend #infra #strategic
- [ ] **18 · S4** Principled exploration — contextual bandit / Thompson sampling (use logged `predicted_score` as propensity) replacing `rng.uniform` jitter #rec #backend #strategic
- [ ] _S3 (multi-user data model + Postgres + Redis) → tracked in **Launch-Gating** as C1/C4. S5 (retention features) → tracked in **Product / UX Backlog**._


## 🚀 Launch-Gating — required before any public multi-user launch

- [ ] **C1** User identity + data isolation: `users` table, session/device id, `user_id` FK on all data, scope every query #critical #backend #db #blocker
- [ ] **C2** Capability-token share links (`/watchlist/share/{token}`), never "all rows" #critical #backend #blocker
- [ ] **C3** Auth + per-IP/user rate limit + daily LLM budget guard on `/recommendations` #critical #backend #blocker
- [ ] **C5** Make `GET /recommendations` read-only; move impression writes to `POST /events`, TTL sweeps to cron #critical #backend
- [ ] **C4** Migrate SQLite → Postgres + Redis for the shared cache (multi-worker safe) #critical #db #infra


## 🛠️ Engineering Backlog (secondary — lower value than Rec Quality)

- [ ] **CFG** `/config` endpoint (genres + providers) → kills the last cross-layer constant drift #medium #backend #frontend
- [ ] **E2E** One Playwright smoke test: rate → recommend → watchlist #medium #frontend #test
- [ ] **M9b** Broader inline-`style` → CSS-class migration (literal-hex slice already done) #medium #frontend
- [ ] **OBS** Observability: structured logs + basic metrics (rec latency, LLM spend, channel-empty rate) #low #backend
- [ ] **L5** Type-checking + a CI pipeline (mypy backend, tsc/lint/tests in CI) #low #infra
- [ ] **TMDB-MERGE** Merge the two `_tmdb_get` helpers into one `tmdb` client module #low #backend


## 💡 Product / UX Backlog

- [ ] **UX1** Command palette (⌘K) to jump to any movie/person #ux #frontend
- [ ] **UX2** Keyboard nav on the card grid (arrows + Enter) #ux #a11y #frontend
- [ ] **UX3** "Why this pick" expansion on For You cards (full reasoning inline) #ux #frontend
- [ ] **UX4** Settings page for default streaming services (today only inline on For You) #ux #frontend
- [ ] **UX5** "Not interested" management page + time-decay of exclusions (API already exists) #ux #backend #frontend
- [ ] **UX6** Empty-watchlist → For You bridge (add top picks from the empty state) #ux #frontend
- [ ] **UX7** Multi-action undo queue (today only the most-recent action is undoable) #ux #frontend
- [ ] **UX8** Light theme (cheap now that everything uses `var(--*)` tokens) #ux #frontend
- [ ] **UX9** Skeleton → content crossfade instead of a hard swap #ux #frontend
- [ ] **UX10** Per-page `<title>` via Next metadata (history/tabs) #ux #frontend
- [ ] **UX11** "You've seen most of your matches" message when the candidate pool shrinks #ux #frontend
- [ ] **UX12** Decouple "rate" from "mark watched" (currently rating force-marks watched) #ux #product
- [ ] **UX13** Rating/Watchlist data symmetry on remove + undo #ux #backend
- [ ] **UX14** Discover "rate films you've seen" nudge when arriving from onboarding #ux #frontend
- [ ] **UX15** Visible "more" affordance on horizontally-scrollable chip rows #ux #a11y #frontend
- [ ] **UX16** Weekly "Movie Night Picks" digest + email/notification (the weekly-return hook) #ux #retention
- [ ] **UX17** Watchlist streaming-availability alerts — "now on Netflix" #ux #retention
- [x] **UX18** ✅ **DONE (2026-06-19)** Taste Profile page (`/taste`) — SVG radar of the 10 bipolar DNA axes (bipolar: center=neg pole, edge=pos pole, dashed mid-ring=neutral; dot size = per-axis confidence) + precise diverging-bar breakdown + top genres/people/themes. New `GET /taste` endpoint (`routers/taste.py`) surfaces the persisted `taste_profile`. Nav link added. _(Editable taste controls deferred — read-only v1.)_ #ux #frontend
- [ ] **UX19** Group "Movie Night" mode — blend 2+ profiles into one pick (the app's namesake) #ux #product


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

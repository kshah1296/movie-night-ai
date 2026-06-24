# QA Review Board — 7-Persona Audit (2026-06-24)

A structured QA pass across 7 reviewer personas, grounded in the actual codebase (file refs inline).
Findings are severity-tagged **P0** (launch blocker) / **P1** (fix soon) / **P2** (improvement).
A consolidated, prioritized backlog is at the bottom and has been added to `to-do.md`.

**Overall launch verdict: CONDITIONAL.** Excellent as a *single-user* personal tool / portfolio demo.
**Not** ready for a *public, multi-user* launch until the C-tier (auth, data isolation, rate/budget
limits) + a global error boundary + input bounds on the group endpoint land. See Agent 7.

---

## Agent 1 — Movie Lover (rated 200+ films)

**Verdict:** The engine is genuinely personalized and surfaces niche films — but the *explanations*
undercut trust, and the picks skew old/mainstream for a cinephile.

- **P1 — Explanation sameness (trust killer).** ✅ **FIXED (2026-06-24).** When Groq quota is exhausted
  (often — 100K tokens/day), *every* card fell back to the same template: "Shares the fast-paced,
  emotional feel of **X** from your favorites". Now `_template_reason_v2` keys on the strongest concrete
  match via `_matched_signal` (loved director → actor → theme → genre → DNA/anchor) with deterministic
  phrasing variants, so the fallback reads differently per card (e.g. "Directed by Nolan, whose films keep
  landing for you" / "Built on a 'time loop' story…" / "Thriller done well (6.9★) — in your wheelhouse").
- **P1 — Picks skew old + mainstream.** Real output for a heavy rater included *A.I.*, *Mad Max (1979)*,
  *Wizard of Oz (1939)*, *Pinocchio (1940)* as top picks. The learned model gave `freshness` a *negative*
  weight on this user's data, so nothing recent surfaces. A cinephile reads a 1939 film as a top rec as
  "stale." Fix: a light recency floor or a "Fresh / Recent" bucket so at least 1–2 picks are <3 yrs old.
- **P2 — Anchor repetition.** "Inspired by X" frequently repeats the same 1–2 loved movies across the set;
  diversify anchors so the strip feels less like a broken record.
- **Strengths:** Hidden Gems + Underseen Favorites buckets genuinely surface niche films; the per-card
  bucket tag + "Why this pick?" expander give more transparency than Netflix; deterministic ranking means
  it never silently degrades.
- **Niche films surfaced?** Yes (dedicated buckets + a hidden-gem retrieval channel). Good.
- **Repetitive?** Rotation penalty + refresh jitter help, but the identical explanation template makes it
  *feel* repetitive even when the picks aren't.

## Agent 2 — Senior Product Manager

**Verdict:** Strong differentiated *core* (taste transparency + group mode), but **zero retention
mechanics** — there is currently no reason to come back next week.

- **Biggest strengths:** (1) **Taste DNA transparency** (the radar) — no competitor shows you *why*;
  (2) **Group "Movie Night" mode** — a real wedge Letterboxd/Netflix don't have; (3) cross-streaming
  (not locked to one catalog); (4) honest, deterministic recs.
- **Biggest weaknesses:** (1) **No retention loop at all** — no weekly digest, no notifications, no
  "new for you this week," no streaks (UX16/UX17 deferred). (2) **Single-profile, no accounts** — can't
  retain, share, or grow virally; everything is one anonymous local user. (3) Group mode is a *one-off*
  utility, not a recurring habit.
- **Why would users return weekly?** Today: they wouldn't. The only pull is "I need a movie tonight,"
  which is episodic, not habitual. **P1 — ship one retention hook** (weekly "3 picks for you" digest is
  the cheapest; you already have cloud-routine infra for the stock emails).
- **vs Letterboxd:** Weaker on social/logging/reviews/lists; **stronger** on personalized recommendations
  + group mode. Don't try to out-social Letterboxd — lean into "tells you what to watch *tonight*."
- **vs Netflix:** Can't play anything; it's a *decision layer* on top of every service. The pitch is
  "stop scrolling 40 min" — but that promise needs the watchlist "tonight" shortcuts to be instant.
- **Product risks:** quota dependency (Groq) for the *feel* of the product; single-user ceiling caps any
  real metrics; no analytics on actual user behavior (the `/analytics` endpoint exists but is
  backend-only and measures the engine, not retention/funnel).
- **Missing features:** accounts, retention loop, a true "movie tonight in 1 tap" flow, saved group crews.

## Agent 3 — Staff Product Designer (UX)

**Verdict:** Clean, tokenized design system with good empty/loading states — but For You and Discover
both risk **decision fatigue**, and several features are now **hidden behind icons**.

- **P1 — For You decision overload.** One screen stacks: 12 cards × (poster, 4 score badges, bucket tag,
  anchor kicker, explanation, "Why this pick?", stars, watchlist), plus 4 mood pills + 12 genre chips +
  a streaming toggle + a taste strip. That's a lot of decisions before the first scroll. Consider
  collapsing controls into a single "Refine" affordance and leading with 3–4 hero picks.
- **P1 — Discover filter drawer density.** Sort + genres (multi) + decade + rating + runtime + 8
  providers in one drawer is power-user-dense for a first-timer. Progressive disclosure would help.
- **P2 — Hidden features.** ⌘K palette (now an unlabeled 🔍), "Why this pick?" (collapsed), 🎲 Surprise
  Me, and the group quick-rate are all discoverable only by exploration. First-timers won't find them.
- **P2 — Icon-only nav items.** 🧬 Taste DNA and ⚙️ Settings have no text label (tooltip only) — fine for
  Settings (conventional gear), weaker for Taste DNA (a flagship feature reduced to an emoji).
- **First-time struggles per screen:** *For You* — "why is it empty?" (must rate first; onboarding helps).
  *Discover* — overwhelmed by the filter drawer. *Movie Night* — a guest may not recognize any of the 18
  trending films offered to rate. *Watchlist* — fine. *Taste DNA* — needs a legend (the bipolar radar is
  novel and not self-explanatory; we added a one-line hint but it may not be enough).
- **Strengths:** consistent tokens, real empty states, skeleton→content crossfade, reduced-motion + focus
  trap + 44px targets. The polish baseline is genuinely good.

## Agent 4 — Watchlist Specialist (assume 100 saved movies)

**Verdict:** Good "find a movie tonight" toolkit, but **no virtualization** and **no in-list search**
make 100+ items heavier than they should be.

- **P1 — No virtualization / pagination.** `getWatchlist()` (`lib/api.ts`) fetches with no limit (backend
  caps at 1000) and the page renders **every** card at once (`app/watchlist/page.tsx`), each triggering
  batched runtime + provider + score fetches. At 100 it's sluggish; at 500+ it janks. Virtualize or
  paginate.
- **P1 — No search within the watchlist.** With 100 items you can't type to find "that sci-fi I saved."
  Sort/filter help, but a text filter is table stakes at this scale.
- **P2 — Missing "tonight in one tap" shortcut.** The pieces exist (runtime + streaming + rating) but the
  user must assemble them. A single "🍿 Tonight" button — *"≤2h, on my services, highly rated, pick one"* —
  would nail the core promise. This is the highest-value AI surface the page is missing.
- **P2 — No grouping by service / no bulk actions.** Can't see "what's on Netflix" as a group; can't
  multi-select to remove.
- **Can users quickly decide?** Mostly — sort by shortest/highest-rated + the 🎲 Surprise Me are strong.
  But it requires manual filter assembly.
- **Is streaming filtering available?** Yes ("📺 On my services"). **Short movies?** Yes (runtime chips).
  **Highly rated?** Yes (sort). Coverage is good; *speed-to-decision* is the gap.
- **Scores:** **Storage Utility 8/10** (solid CRUD, sort, persistence). **Decision Utility 7/10** (great
  pieces, no one-tap "tonight"). **Delight 6/10** (Surprise Me is fun; no virtualization + no in-list
  search caps it). Why: it's a *capable* tonight-tool that still asks the user to do the assembly.

## Agent 5 — Recommendation Engine Auditor (Senior ML)

**Verdict:** Unusually principled for a side project (deterministic, eval-gated, learned ranker) — the
real gaps are **no exploration** and **tiny-data overfitting risk**.

- **Candidate generation:** 6 channels (similar/keywords/people/hidden-gem/popular/wildcard) round-robin
  to `POOL_SIZE=60`. All TMDB-API-driven, several sorted by popularity → **moderate popularity bias** in
  the *pool* (partly countered by the hidden-gem channel + the scorer's `pop_penalty`). No embedding/ANN
  retrieval (S2 deferred) → recall is bounded by TMDB's own "similar"/keyword graph.
- **Ranking:** learned standardized-linear model (S1), gated by an offline time-split eval (Pearson
  −0.15→+0.23). **P1 — overfitting risk:** ~159 ratings / 10 features. Ridge + leave-one-out + the eval
  gate mitigate it, but the win is modest and the model needs periodic retraining as data grows.
- **Diversity:** MMR hard caps (≤2 director, ≤4 genre, ≤2 decade) + 6 product buckets → **genre collapse
  is prevented per-page.** Good.
- **Novelty / popularity:** `discovery` + `pop_penalty` terms exist, but the **eval holds `vote_average`/
  `vote_count` at constants**, so those two features learn ≈0 weight — they only vary at *serve* time and
  aren't validated. Novelty is therefore unmeasured.
- **Exploration vs exploitation:** **P1 — no principled exploration.** Only a seeded jitter; no bandit /
  Thompson sampling (S4 deferred). The engine is exploitation-heavy → **longitudinal filter-bubble risk**:
  the per-page genre cap stops collapse *within* a page but not *over weeks* as the profile sharpens
  toward the host's dominant genres.
- **Cold start:** `<4` ratings injects a trending channel — reasonable but generic.
- **Missing signals:** no temporal/recency weighting (Q4 skipped — ratings were bulk-entered, so
  `created_at ≠ viewing order`), no watch-completion, no session/context (time-of-day, mood-of-night),
  no collaborative filtering (impossible while single-user), and the group blend uses **genre + proxy-DNA
  only for guests** (no people/theme) → lower-fidelity guest matching.
- **Better strategies:** (1) embedding retrieval (S2) to escape TMDB's similarity graph; (2) a bandit for
  exploration (S4); (3) put real `vote_average`/`vote_count` into the eval so novelty is actually
  validated; (4) upgrade guest profiles in group mode once a guest has enough ratings.

## Agent 6 — Adversarial Tester

**Verdict:** Most edge cases are handled gracefully (validation, fallbacks, optimistic-revert) — but
there are **three real breakers**: no global error boundary, no request timeouts, and an unbounded group
endpoint.

- **P0 — No global error boundary.** ✅ **FIXED (2026-06-24)** — added `app/error.tsx` (route),
  `app/global-error.tsx` (root layout, self-contained), `app/not-found.tsx` (404). A render exception now
  shows a recovery UI instead of a white screen.
- **P0 — Group endpoint has no input bounds.** ✅ **FIXED (2026-06-24)** — Pydantic caps (≤10 members,
  ≤200 ratings/member, ≤50 genre_ids, rating 1–5) → 422 on over-limit input; guests with <3 ratings dropped
  server-side. Closes the `O(candidates × members)` DoS.
- **P1 — No request timeout client-side.** `req()` (`lib/api.ts`) has no `AbortController`/timeout. A hung
  TMDB/Groq call leaves For You spinning indefinitely (we saw Groq 429-retry storms make `/recommendations`
  slow). Add a timeout + a "taking longer than usual" affordance.
- **P1 — Empty/zero-rating guest.** A guest saved with 0 (or all-neutral) ratings yields a zero DNA vector;
  the blend still "works" but contributes noise. Require ≥N ratings server-side (frontend enforces 3, the
  API doesn't).
- **Handled well (verified):** invalid ratings rejected (`Field(ge=1, le=5)` + CheckConstraint); duplicate
  movies (unique `tmdb_id` + upsert); missing posters (🎬 fallback in `Poster`); no ratings (onboarding);
  empty watchlist (For You bridge); API failures (try/catch + error states + optimistic revert); thousands
  of ratings (backend bounded to 1000; facet enrichment ≤15/req, DNA ≤8/req — degrades, doesn't crash);
  modal load failure (graceful `loadError`).
- **Thousands of ratings caveat (P2):** `_build_profile` + DNA aggregation run over *all* ratings every
  request with no cap → first loads get slow (seconds) before caches warm. Bounded but not fast.

## Agent 7 — Launch Readiness Review (Staff Engineer)

**Decision: CONDITIONAL** — **approve for personal / portfolio / single-user demo**; **do NOT approve a
public multi-user launch** until the P0s below are fixed. The architecture is clean (pydantic-settings,
pooled httpx, lifespan, Alembic, eval-gated engine, unit tests) but it was *designed* single-user.

**P0 — must fix before any public/multi-user launch**
- **No authentication or user identity** (C1). Ratings are global (`user_id="local"`); every visitor
  shares one brain.
- **Share link leaks everything** (C2). `/share` reads the same global watchlist — there are no per-user
  capability tokens.
- **No rate limiting or LLM-budget guard** (C3). Any client can drain your 100K Groq tokens/day and hammer
  TMDB/OMDb with no throttle. `POST /events` and `/recommendations` are unauthenticated + unbounded.
- **No global error boundary** (Agent 6) → white-screen on any render crash.
- **Unbounded group endpoint** (Agent 6) → trivial DoS.
- **SQLite single-writer** won't survive concurrent multi-user writes; needs Postgres (C4) before scale.

**P1 — fix soon**
- No observability (structured logs exist, but no metrics: rec latency, Groq spend, channel-empty rate,
  error rate). You're flying blind on cost + reliability.
- No E2E test (only unit). One Playwright smoke (rate → recommend → watchlist → group) would catch the
  white-screen class of bug.
- No client request timeouts (Agent 6).
- Watchlist not virtualized (Agent 4).
- In-process response cache (`_cache` dict) is per-process, lost on restart, not shared across workers —
  fine now, breaks under horizontal scale.
- CORS is locked to `localhost:3000` — must be updated + tightened per-env at deploy.

**P2 — improvements**
- Explanation variety (Agent 1), recency floor (Agent 1), retention loop (Agent 2), decision-fatigue
  reduction (Agent 3), watchlist "Tonight" one-tap + in-list search (Agent 4), exploration bandit + S2
  retrieval (Agent 5), `/config` endpoint to kill the duplicated genre/provider constants.

**Architecture / Performance / Scalability / Security / Observability / Reliability / Accessibility:**
- *Architecture* ✅ clean, layered, testable. *Performance* ⚠️ first-load slow under big profiles / quota
  storms. *Scalability* ❌ SQLite + in-proc cache + single profile. *Security* ❌ no auth / rate limit /
  data isolation. *Observability* ❌ no metrics. *Reliability* ⚠️ no error boundary / timeouts.
  *Accessibility* ✅ strong baseline (focus trap, `aria-*`, reduced-motion, 44px, contrast).

---

## Resolution log (2026-06-24)

**All non-C-tier QA findings were fixed the same day.** ✅ QA-EXPL (explanation variety) · QA-EB
(error boundaries + 404) · QA-GB (group input bounds) · QA-TIMEOUT (30s request abort) · QA-WLVIRT
(watchlist search + render cap) · QA-OBS (structured rec-latency log) · QA-E2E (Playwright smoke, 3
passing) · QA-FRESH (recency guarantee) · QA-TONIGHT (watchlist one-tap) · QA-FATIGUE (Refine toggle) ·
QA-GUESTFI (full-fidelity guests) · QA-ANCHOR (anchor diversity). **Still open: the C-tier** (C1 auth +
data isolation, C2 share tokens, C3 rate/budget limits, C4 Postgres) — the real public-launch gate.

## Consolidated prioritized backlog (added to `to-do.md`)

**P0 (pre-public-launch)** — mostly already tracked as C-tier:
1. `QA-EB` Global error boundary (`error.tsx` + `global-error.tsx` + `not-found.tsx`). *(new)*
2. `QA-GB` Bound the group endpoint (≤10 members, ≤200 ratings/member; server-side ≥3 min). *(new)*
3. C1 user identity + data isolation · C2 capability-token share · C3 auth + rate + LLM-budget guard.

**P1 (fix soon):**
4. `QA-EXPL` Explanation-template variety (3–4 variants keyed on the strongest matched signal). *(new)*
5. `QA-TIMEOUT` Client request timeout + "taking longer" UI in `lib/api.ts`. *(new)*
6. `QA-WLVIRT` Virtualize / paginate the watchlist + in-list text search. *(new)*
7. `QA-RETAIN` Ship one retention hook (weekly "3 picks" digest — reuse cloud-routine infra). *(= UX16)*
8. OBS observability (rec latency, Groq spend, error rate) · E2E Playwright smoke.

**P2 (improvements):**
9. `QA-FRESH` Recency floor / "Recent" bucket so 1–2 picks are <3 yrs old. *(new)*
10. `QA-TONIGHT` Watchlist "🍿 Tonight" one-tap (≤2h + on my services + top-rated → one pick). *(new)*
11. `QA-FATIGUE` Reduce For You / Discover decision load (collapse controls, lead with hero picks). *(new)*
12. `QA-GUESTFI` Upgrade group guests to full-fidelity profiles once they have enough ratings. *(new)*
13. S2 embedding/ANN retrieval · S4 exploration bandit · CFG `/config` endpoint.

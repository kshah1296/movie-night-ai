# UX19 — Group "Movie Night" Mode (scoping plan)

**Date:** 2026-06-21
**Status:** ✅ **SHIPPED (2026-06-21)** — backend (`group.py` + `POST /recommendations/group`, parallel
builder so the single-user path is untouched), frontend (`/group` page, guest quick-rate, localStorage,
member-fit chips), nav entry, unit tests (`test_group.py`). All 77 backend tests pass; tsc clean.
**Design note:** chose a parallel `build_group_recommendations` over refactoring the eval-gated single-user
function — lower risk, still reuses every pure/cached helper.
**Why now:** The recommendation engine + UX are done. This is the app's **namesake** and its best demo:
"everyone rates a few, get one movie you'll *all* enjoy." It builds entirely on the existing Taste-DNA
engine and needs **no new infra** (no auth, email, or cron).

---

## The idea in one line
Blend 2+ people's Taste-DNA into a single ranked list optimised so **nobody hates the pick** — not a
bland average, but a "least-misery + average" objective.

## Design decisions (resolved)
1. **No accounts.** "You" = the existing global ratings (the rich host profile). A **guest** is an
   in-session, lightweight profile: a name + a handful of movies they rate right there. Guests are
   held in the browser (localStorage, reusable across sessions); the backend stays **stateless**.
2. **Guest taste is cheap.** A guest's DNA comes from `proxy_dna` over their rated movies' genres
   (free, instant, no extra TMDB calls — the frontend already has `genre_ids`). Their genre affinity is
   tallied the same way `_build_profile` does. People/theme affinity is skipped for guests in v1 (DNA +
   genre carry the match); the host keeps the full-fidelity profile.
3. **Blend = least-misery + average.** For each candidate, score it for every member with the existing
   `scoring.score_candidate`, then `group_score = min(member_scores) + λ·mean(member_scores)`
   (λ≈0.4). The `min` term means a pick that one person would hate can't win on someone else's
   enthusiasm; the mean term breaks ties toward broadly-loved picks.
4. **Exclusions union.** Anything *anyone* dismissed or has already seen is dropped. A "for everyone"
   pick should be new to the group.
5. **Reuse the host's candidate pool.** The expensive retrieval (TMDB channels, facet + DNA
   enrichment) runs once for the host; guests only re-score that pool. Keeps it fast + quota-safe.

## Architecture
- **Refactor (no behavior change):** extract `_prepare_pool(db, …)` from `build_recommendations` —
  everything up to "score each candidate": exclusions, facets, host profile + DNA, candidate pool,
  per-candidate DNA/facets enrichment, the active learned model. The single-user path calls it then
  scores for the host; the group path calls it then scores for each member + blends.
- **New `backend/group.py` (pure):** `guest_profile(ratings)` (genre affinity + proxy-DNA aggregate),
  `blend_scores(member_scores, λ)`, and `group_reason(candidate, members)` (template "you'll all like
  this — shared <trait>"). Unit-tested, no network.
- **New route `POST /recommendations/group`** (`routers/recommendations.py`): body
  `{ members: [{name, ratings:[{tmdb_id, genre_ids, rating}]}], providers? }`. Host auto-included from
  the DB. Returns the same rec shape + per-pick `member_fit` (how each person scores it) so the UI can
  show "great for Alex, good for you."
- **Frontend `/group` page + 🎬 nav entry:** add guests (name → quick-rate ~5 popular/diverse movies
  via the existing `StarRating`), see the blended picks with per-person fit chips + a group reason.
  Guests persist in localStorage so a recurring movie-night crew is one tap to reload.

## Phases
1. **Backend** — `_prepare_pool` extraction (+ confirm single-user output unchanged via the eval/tests),
   `group.py`, the `/group` route, unit tests (`test_group.py`). ← start here
2. **Frontend** — `/group` page, guest quick-rate flow, blended results UI, nav entry, localStorage.
3. **Polish** — per-pick "great for X" fit chips, optional LLM group reason, empty/cold states.

## Verification
- `venv/bin/pytest` green (new `test_group.py` asserts least-misery beats naive-average on a
  constructed case; union exclusion holds).
- Single-user `/recommendations` output **unchanged** after the `_prepare_pool` refactor (diff a curl
  before/after; eval metrics identical).
- `curl POST /recommendations/group` with 2 members → picks that score ≥ floor for *both*; a movie one
  member dismissed never appears.
- Frontend: add a guest, quick-rate, get blended picks; reload page → guest persists.

## Out of scope (v1)
Saved/named server profiles, >4 members UI density, real-time multiplayer. All additive later.

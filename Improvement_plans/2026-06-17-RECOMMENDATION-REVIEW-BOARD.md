# Recommendation Engine — Multi-Agent Review Board & Roadmap

**Date:** 2026-06-17
**Method:** Four independent cold reviewers (no shared context, no access to each other's output or to prior review docs), each scoped to the recommendation engine only, followed by a VP-of-Engineering synthesis. Reviewers: **Netflix Rec-Systems Engineer**, **Principal ML Engineer**, **Senior Product Manager**, **Principal Engineer (hostile / devil's advocate)**.

---

## Scorecard

| Reviewer | Lens | Score |
|---|---|---|
| Netflix Rec Engineer | recommendation quality | **5.5 / 10** |
| Principal ML Engineer | engine as an ML system | **4 / 10** (7/10 as a single-user LLM-assisted MVP) |
| Product Manager | user value / weekly retention | **6.5 / 10** (8–9 on rec *craft*, 4–5 on retention) |
| Principal Engineer (hostile) | will it fail? | **3 / 10** |

**Spread reads cleanly by lens:** the engineering *craft* is above-average for an MVP (everyone said so), but the closer a reviewer looked at it *as a learning system*, the lower the score. The product reviewer scored highest because the rec *experience* (explanations, taste strip, buckets) is genuinely strong; the ML/hostile reviewers scored lowest because **nothing actually learns.**

---

## 1. Areas of agreement (high-confidence — found independently by ≥3 reviewers)

1. **The feedback loop is open.** `RecEvent` logs clicks, trailer-plays, watchlist-adds, and skips (`events.py`), and `/analytics` even computes a predicted-vs-actual `pearson_r` (`analytics.py:74`) — but **none of it feeds ranking.** `score_candidate` never reads `RecEvent`. *(All 4 reviewers — Netflix W3/A1, ML §4, PM bet #6, Hostile §F/thesis.)* This is the single most-agreed finding.
2. **Watched + post-watch ratings are ignored by personalization.** The profile is built from `Rating` rows and *un*watched watchlist items only (`recommendations.py:746`, `_build_profile`), so a movie you actually watched and rated contributes nothing — even though `analytics.py:55` already reads `post_watch_rating`. *(Netflix W1, PM, Hostile.)*
3. **Taste-DNA is mostly a genre proxy, and genre is double-counted.** `proxy_dna` is a genre→nudge lookup (`dna.py:42`); with `DNA_BATCH_LIMIT=8`, most candidates are scored on proxy DNA. So `dna_sim` (weight **0.34**, the largest) and `genre_affinity` (0.16) are collinear — ~half the "personal" score is genre, counted twice. *(Netflix W4/R1, ML §2, Hostile §B/§D.)*
4. **No learned model; hand-tuned weights are never fit to the data being collected.** Every nudge table and the 8 scoring weights are typed by hand (`scoring.py:14`). The impression→action log is the exact training corpus for learning-to-rank — and it's deleted after 90 days unused. *(ML §3, Hostile §D, Netflix #10.)*
5. **`not_interested` is a blunt exclusion, not negative taste — and `not_interested_titles` is a dead variable.** It's computed (`recommendations.py:732`) but, after the V3 rewrite replaced `_groq_rank_v2` with `_groq_explain`, **it's no longer passed to any prompt.** Dismissing a film teaches the model nothing about *why*. *(Netflix W2, Hostile §F, PM — confirmed: this is a real regression.)*
6. **Cold-start / thin profiles are generic.** Profile gates (`>=2` keywords, `>=3` people/decade) leave new users with near-zero theme/people affinity, collapsing the score to "popular highly-rated movies in your genre"; zero ratings returns an empty list with no onboarding retrieval. *(Netflix D5/D6, ML, PM bet #10.)*
7. **Retrieval is popularity-anchored, not personalized, and the pool is too small.** Every channel sorts by `popularity.desc`/`vote_average.desc`; the pool caps at 36, so the diversity/bucket machinery often has almost nothing to choose from. *(Netflix A4, Hostile §A, ML §6.)*
8. **Single-user data model + SQLite + in-process caches cap everything.** No `user_id` on the interaction tables; module-global dicts; whole-table `.all()` reads. *(ML §1/§5, Hostile §G — also the standing C-tier from the prior principal-engineer audit.)*

**Other confirmed code-level catches (high confidence, narrow):**
- **The `recently_shown` rotation penalty is applied in the wrong stage** — it's added to the *candidate* `_score` (`recommendations.py:496`) which is then discarded; the real `score_candidate` never sees it, so rotation is weaker than it looks. *(Hostile §F.)*
- **User-DNA vs candidate-DNA instrument mismatch** — the user vector is partially LLM-scored while candidate vectors are almost always proxy, so `dna_distance(user, candidate)` compares two different instruments. *(Hostile §C, ML §2, Netflix W4.)*
- **DNA shifts with no user action** as the LLM backlog drains across requests; LLM scoring is non-reproducible (temp 0.2) and cached forever with no `model_version`. *(Hostile §B/§H, ML §1.)*
- **No recency/decay** — `Rating.created_at` exists but is never used; the profile is a lifetime average. *(Netflix D3, ML §1.)*

---

## 2. Areas of disagreement (with VP ruling)

- **Incremental fix vs. ground-up rebuild.** Netflix/PM lean "fix the existing pipeline"; ML/Hostile lean "rebuild as learned-to-rank + embeddings + offline eval." **Ruling:** do both, sequenced — capture the cheap high-confidence wins now (they help regardless), and stand up the offline-eval harness early so the rebuild is *measurable* rather than another set of hand-tuned guesses.
- **Buckets/MMR: drop or feature?** Hostile calls them "theater" (Pass-3 relaxation makes them ~top-12-by-score with labels) and wants them dropped; PM loves them as a discovery frame and wants them *more* visible (browsable rows). **Ruling:** keep buckets as a **UI grouping of the ranked result**, not as a hard constraint that fights the ranker — which satisfies both. Fix the label-race and the "mandated weak picks" problem; don't delete the concept users like.
- **Engine quality is great (PM 8–9) vs. poor (Hostile 3).** Not actually contradictory: PM scored the *experience*, Hostile scored the *learning system*. **Ruling:** both true — strong content-based re-ranker, no learning loop. Treat "close the loop" and "build the retention layer" as two parallel workstreams.
- **Is the DNA model worth keeping?** ML/Hostile say it's weak as the core representation (single centroid collapses multimodal taste; axes asserted not learned); PM says it's the best *delight/explainability* feature. **Ruling:** keep DNA as an **interpretable side-feature + the "Your taste" UI**, stop treating it as the primary similarity space, and validate it (does DNA-distance predict rating?). Don't let a 0.34 weight ride on an unvalidated genre echo.

---

## 3. Highest-confidence issues, ranked

1. Open feedback loop — behavior never re-enters ranking (4/4).
2. Watched/post-watch ratings dropped from the profile (3/4).
3. DNA = genre proxy, double-counted, instrument-mismatched (4/4).
4. No learning / weights unfit / training log discarded (3/4).
5. `not_interested` underused + `not_interested_titles` dead (3/4).
6. Generic cold-start / thin-profile experience (3/4).
7. Popularity-anchored retrieval + 36-item pool too small for diversity to matter (3/4).
8. Single-user schema + SQLite + in-proc cache ceiling (2/4, plus prior audit).

---

## 4. Prioritized roadmap (impact × effort)

> Impact: 🔴 high · 🟠 medium · 🟡 low. Effort in the heading.

### Quick wins — < 1 day each
| # | Change | Impact | Why / source |
|---|---|---|---|
| Q1 | **Fold watched + `post_watch_rating` into `_build_profile` and the DNA aggregate** | 🔴 | Recovers the strongest dropped signal; data already read by analytics. (#2) |
| Q2 | **Use `not_interested` as negative taste** — penalize its keywords/director/DNA region; and either wire `not_interested_titles` into `_groq_explain` or delete it | 🔴 | Fixes a confirmed dead path; turns dislikes into learning. (#5) |
| Q3 | **Move the `recently_shown` penalty into `score_candidate`** (not the discarded candidate `_score`) | 🟠 | Makes rotation actually work; kills the "same cluster every 4th day." (Hostile §F) |
| Q4 | **Add recency decay** to rating weights using `Rating.created_at` | 🟠 | Models taste drift; stops the lifetime-average → generic trend. (#9) |
| Q5 | **Real cold-start path** — for <5 ratings return a trending/genre-sampler with honest "still learning, rate N more" framing (surface `dna_confidence`) | 🔴 | First-impression quality + drives the core rating loop. (#6) |
| Q6 | **Bust `TasteAnalysis`/cache on watchlist + not-interested changes**, not just rating edits; include the `shown` set in the cache fingerprint | 🟡 | Stops stale taste reading + cached-identical refreshes. (Netflix D1/A3) |

### Medium projects — < 1 week each
| # | Change | Impact | Why / source |
|---|---|---|---|
| M1 | **Behavioral ranking term** — derive per-movie/theme/person affinity from click/trailer/watchlist (+) and skip (−); add `W_BEHAVIOR` to `score_candidate` | 🔴 | *The* fix for the open loop; turns logged-but-unused events into improving picks. (#1) |
| M2 | **Personalize retrieval** — add a DNA/behavior nearest-neighbor candidate channel; grow the pool to 150–300; reduce reliance on `popularity.desc`/page-18 discover | 🔴 | Root fix for "generic"; gives diversity selection real choices. (#7) |
| M3 | **Fix DNA coverage & instrument mismatch** — LLM-score the user's *rated* set fully (small), only proxy *candidates*; down-weight `W_DNA` when candidate DNA `source=="proxy"`; de-collinear genre vs DNA | 🔴 | Makes the 0.34 weight honest. (#3, Hostile §C/§D) |
| M4 | **De-saturate `genre_affinity`** — normalize by the user's own genre distribution (share/z-score) instead of fixed `GENRE_NORM=8` | 🟠 | Keeps the term discriminating for heavy users (where it currently pins to 1.0). (Netflix R2) |
| M5 | **Offline eval harness** — time-split each user's ratings; report NDCG@12 + rating RMSE + the existing `pearson_r`; gate weight/feature changes on it | 🔴 | Makes every later change measurable instead of another guess. (ML §4, Hostile §4) |
| M6 | **Versioning + TTL on derived caches** (`MovieDNA`/`MovieFacets`: `model_version`, `schema_version`, refresh on bump) | 🟠 | Stops permanently-stale vectors; lets you change the DNA prompt safely. (Hostile §B/§G) |
| M7 | **Buckets as post-hoc UI grouping, not a hard constraint** — add a fit-floor before a Hidden-Gem/Underseen pick takes a reserved slot; fix the label race | 🟠 | Ends "5/12 mandated weak picks + confident prose over them." (#3 disagreement ruling) |
| M8 | **Snapshot `TasteProfile` over time** (stop overwriting) | 🟡 | Enables "taste evolution" — an ML drift signal *and* a PM retention moment. (ML §1, PM bet #9) |

### Strategic projects — < 1 month each
| # | Change | Impact | Why / source |
|---|---|---|---|
| S1 | **Learning-to-rank model (LightGBM/LambdaMART)** trained on the implicit-feedback log; keep the current features as inputs, retire the hand weights | 🔴 | Converts the system from "can't improve" to "learns from its own logs." Needs M5 first. (ML §6, Hostile §D) |
| S2 | **Offline catalog enrichment + embedding/ANN retrieval** — nightly batch computes embeddings (and versioned LLM DNA) for the catalog; serve candidates from an ANN index; keep TMDB discover as cold-start/freshness only | 🔴 | Removes per-request TMDB/LLM fan-out from the hot path; real personalized retrieval. (ML §6, Hostile §4) |
| S3 | **Multi-user data model + Postgres + Redis** — `user_id` everywhere, shared cache, worker-safe; unlocks collaborative filtering (the strongest at-scale signal, structurally impossible today) | 🔴 | Prereq for scale *and* CF; overlaps the prior audit's C1/C4. (ML §5, Hostile §G) |
| S4 | **Principled exploration** — replace `rng.uniform`/jitter with a contextual bandit / Thompson sampling; use the already-logged `predicted_score` as propensity for off-policy eval | 🟠 | Makes exploration measurable and the Wildcard slot earn its keep. (ML §3, Hostile §A) |
| S5 | **Retention product layer** (PM workstream, parallel to ML): weekly time-seeded "Movie Night Picks" + email, **watchlist streaming-availability alerts**, a **Taste Profile page** (radar of the 10 axes + confidence), and **group "Movie Night" mode** (blend 2+ profiles — the feature the app's *name* promises) | 🔴 | The engine answers "what tonight?" but gives no reason to return *weekly*; these build the heartbeat. (PM §1, bets #1/#2/#4/#5) |

---

## 5. North-star architecture (consensus of the ML + hostile reviews)

Reuse the genuinely good parts — the impression/event log, the multi-channel retrieval pattern, the LLM-out-of-the-ranking-loop decision, the MMR diversity selector, and the DNA layer *as interpretable explainability* — and add the missing half:

- **Storage:** Postgres; every interaction row carries `user_id`, `item_id`, `event_type`, `context` (mood/genre/provider), `timestamp`, and the **logged propensity** (already ~present as `predicted_score`). Never TTL the event log — roll it to columnar storage.
- **Retrieve:** ANN over content (and later collaborative) embeddings, K≈200; TMDB discover demoted to cold-start/freshness.
- **Preference model:** learned user embeddings (handles multimodal taste the single DNA centroid can't); DNA kept as a side-feature + UI.
- **Rank:** learned-to-rank on implicit-feedback labels (`reward = w·click + w·trailer + w·watchlist + w·rating`), position-debiased via logged propensity; calibrate so `predicted_score` is a real probability and `pearson_r` becomes a loss to minimize.
- **Diversify:** real MMR post-ranking; buckets as UI grouping.
- **Eval:** nightly offline replay (NDCG/recall@k, calibration, coverage, novelty, diversity) gating deploys; `user_id`-keyed A/B with `model_version`/`arm` columns.
- **Serve:** precompute profiles + candidates into Redis; LLM explanations async + cached. No synchronous TMDB/LLM fan-out on the hot path.

---

## 6. Appendix — per-agent summaries

**A1 · Netflix Rec Engineer (5.5/10).** "A well-engineered content-based re-ranker with excellent plumbing and a glaring missing half — it observes behavior beautifully and learns from none of it." Top fixes: close the loop (RecEvent→ranking), fold in watched ratings, make `not_interested` negative taste, personalize retrieval, fix DNA coverage, de-saturate genre, cluster-level rotation, novelty buckets must earn seats, real cold-start, wire analytics into a guardrail.

**A2 · Principal ML Engineer (4/10).** "Not a learned recommender — a hand-tuned heuristic ranker with an LLM bolted on for feature extraction and copywriting." Emphases: structurally single-user schema (`tmdb_id UNIQUE`, `user_id="local"`); the event log is unused training data; single-centroid DNA collapses multimodal taste; the central feature is an unvalidated non-deterministic LLM label cached forever; no offline eval/A-B despite logging propensity-like data; SQLite + in-proc caches cap concurrency. Wants learned embeddings + LTR + offline harness + feature store.

**A3 · Product Manager (6.5/10).** "Excellent recommendation craft, immature retention product — there is no structural reason to return *weekly*." Strengths: the "Your taste" strip, anchored explanations, buckets as a discovery frame, honest degradation, mood modes. Missing: weekly digest + notifications, streaming-availability alerts, a Taste Profile page, **group/"Movie Night" mode** (the app's namesake), browsable bucket rows, editable taste controls, and use of the implicit signals already collected. Trust is strong but **read-only** — users can see what it learned, can't correct it.

**A4 · Principal Engineer / hostile (3/10).** "An elaborate, untrained, unvalidated heuristic stack masquerading as a learned taste model — with no closed feedback loop, so it can never get better." Sharpest unique catches: rotation penalty applied to the discarded candidate score (not the real ranker); genre double-counted through DNA; user-vs-candidate DNA instrument mismatch; serve-time candidate-proxy writes poison the cache and never upgrade; `select_with_buckets_mmr` contains no actual MMR; decade filter only fires on `seed % 2 == 1`; `not_interested_titles` dead. Verdict: "the hand-tuned weights aren't the disease; they're the symptom — the disease is no data loop."

---

## Recommended first move

If we do nothing else this month: **Q1 + Q2 + M1 + M5** — fold watched ratings + dislikes into the profile, add the behavioral ranking term, and stand up the offline-eval harness. That closes the feedback loop (the one thing all four reviewers independently flagged) *and* makes every subsequent change measurable. Everything strategic (S1–S4) should wait behind M5 so we stop hand-tuning blind.

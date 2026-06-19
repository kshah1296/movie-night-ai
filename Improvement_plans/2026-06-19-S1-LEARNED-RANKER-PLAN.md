# S1 — Learned Ranker (scoping plan)

**Date:** 2026-06-19
**Status:** ✅ **SHIPPED (2026-06-19)** — built as specced (numpy Ridge, leave-one-out features, CV alpha,
eval-gated). The learned model is active and serving.

> **Result (gated time-split — train on 111 ratings, hold out the most-recent 48):**
>
> | Metric | Hand-tuned baseline | Learned (S1) |
> |---|---|---|
> | Pearson | −0.1465 | **+0.2273** |
> | Spearman | −0.2389 | **+0.2337** |
> | NDCG@12 | 0.6064 | **0.6310** |
>
> Pearson and Spearman **flip sign** — confirming the root-cause diagnosis (the hand-tuned signs were
> backwards). Shipped: `backend/features.py`, `backend/train.py`, the `LearnedModel` table + Alembic
> migration `d50d33f0d7ec`, and refactors to `scoring.py` / `eval.py` / `routers/recommendations.py` +
> `tests/unit/test_features.py`. Retrain with `venv/bin/python -m backend.train` (re-gates each run; ships
> a new model only if it still beats the baseline). The hand-tuned weights remain the fallback.

**Why now:** The offline eval (M5) has gated out three consecutive hand-tuning attempts — M4 (genre
normalize), Q4 (recency decay), M3 (instrument match). The research (`2026-06-19-LOW-CONFIDENCE-RESEARCH.md`)
proved the root cause: **the scorer's feature *signs* are wrong** (dna_sim, actor, theme, freshness all
negatively correlate with held-out ratings; genre is a dead constant). No per-term knob fixes wrong-signed
features. The only thing that can is **learning the weights (and signs) from data** — that's S1.

---

## 1. Goal & success criteria

Replace the hand-tuned constants in `scoring.score_candidate` (`W_DNA=0.34`, `W_GENRE=0.16`, …) with
**weights learned from the user's own feedback**, so the model can fit — and flip — the signs the eval says
are backwards.

**Acceptance gate (the whole point):** a trained model ships **only if it beats the current eval baseline**
(`venv/bin/python -m backend.eval`): today **Pearson −0.25, NDCG@12 ≈ 0.47**. Target: Pearson clearly
positive and NDCG@12 materially up, on a time-split the model never trained on. If a model can't beat
baseline, **we don't ship it** — and that's itself a valid finding (→ "need more data / multi-user", §6).

---

## 2. The core design

### 2a. One feature extractor, shared by train + serve (`backend/features.py`, new)
Today the feature math lives inside `score_candidate`. Pull it into a pure
`extract_features(cand, profile, user_dna, confidence) -> dict[str, float]` that returns the named features
(dna_sim, genre_affinity, director_affinity, actor_affinity, theme_affinity, freshness, discovery,
pop_penalty, diff_axes, + the new ones below). Both training and serving call it → **no train/serve skew**.
`score_candidate` becomes: `features = extract_features(...)` → `score = model.predict(features)`.

### 2b. Model: start LINEAR, not LightGBM
The research prescribed LambdaMART, but the data is **~150 ratings, one user, ~12 features** — a boosted
tree overfits that instantly. Start with a **regularized linear model** (Ridge / logistic regression,
scikit-learn) that learns one coefficient (weight + sign) per feature. It is:
- enough to fix the wrong-signed-feature problem (the actual diagnosis),
- interpretable (you can read the learned weights and compare to the hand-tuned ones),
- robust on tiny data with L2 regularization + cross-validated `alpha`.

Graduate to **LambdaMART/LightGBM (pairwise ranking loss)** only in Phase 2, when multi-user data exists
(S3). Don't pay the overfitting tax now.

### 2c. Labels
Per rated movie, label = the rating (1–5) → for linear regression, predict the rating directly; for ranking
quality, the eval already measures NDCG with relevance `max(0, rating−2)`. Phase 1 target = the rating.
Later, fold in implicit reward (`click/trailer/watchlist`) as graded relevance.

### 2d. Training pipeline (`backend/train.py`, new — CLI + optional endpoint)
1. Load ratings + cached `movie_facets`/`movie_dna` (reuse `eval.py`'s loaders).
2. **Time-split** (train/validation), identical methodology to `eval.py` so the gate is apples-to-apples.
3. Build feature rows via `extract_features`; standardize features (z-score — critical for linear models).
4. Fit with **cross-validated regularization**; pick `alpha` by validation NDCG/Pearson, not training fit.
5. Run the **M5 eval** on the held-out split; record Pearson/Spearman/NDCG/RMSE.
6. **Only persist the model if it beats baseline.** Save coefficients + feature means/stds + metrics +
   `model_version` to a `LearnedModel` row (DB) — versioned, queryable, no file mgmt.
7. Run: `venv/bin/python -m backend.train` (prints before/after metrics, asks to promote).

### 2e. Serving
`scoring.score_candidate` loads the active `LearnedModel` **once** (module cache, refreshed on version
bump), standardizes features with the stored means/stds, and computes `score = intercept + Σ wᵢ·zᵢ`.
**Fallback:** if no promoted model exists (or <N ratings — cold start), use today's hand-tuned weights.
Deterministic and reproducible, exactly like the current scorer.

---

## 3. The failed tweaks become FEATURES (the key insight)

M4, M1, M3 weren't wrong ideas — they were wrong *as hand-weighted constants*. Inside S1 they're inputs the
model weights correctly:
- **M4 (de-saturate genre):** a learned model can't use a dead-constant feature (zero variance = zero info).
  So S1 **must** make `genre_affinity` vary (the M4 normalization) — but now the model decides its weight,
  instead of us guessing. *M4 only failed because we hand-weighted a newly-noisy feature; learned weighting
  is the right home for it.*
- **M1 (behavioral signals):** add per-candidate click/trailer/watchlist features so the model can use
  engagement directly in ranking (today they only feed the profile).
- **M3 (DNA instrument):** add a `dna_is_proxy` flag feature so the model can discount DNA when the candidate
  vector is a cheap proxy — exactly the "down-weight proxy DNA" micro-move, but learned.

So S1 absorbs the entire per-term backlog: stop arguing about weights, give the model the features, let it fit.

---

## 4. Files to change
- `backend/features.py` (new) — shared `extract_features()`; refactor the math out of `score_candidate`.
- `backend/train.py` (new) — training + CV + eval gate + persist; CLI.
- `backend/models.py` — `LearnedModel` (JSON coefficients, feature stats, metrics, `model_version`, `active`).
- `backend/scoring.py` — `score_candidate` uses the active model (fallback to hand weights); keep buckets/MMR/caps unchanged.
- `backend/eval.py` — call `extract_features` (so eval scores via the same path); add a `--model` compare mode.
- `backend/routers/analytics.py` — optional `GET /analytics/model` (active model + its eval metrics).
- `tests/unit/` — `extract_features` determinism, model load/standardize/fallback, train-split integrity.
- `requirements.txt` — `scikit-learn` (+ `numpy`, already transitive).
- Alembic migration for the `learned_models` table (we adopted Alembic — use it).

---

## 5. Phasing
- **P0 — Feature readiness (½ day):** extract `features.py`; make genre vary (M4 normalization); add
  behavioral + `dna_is_proxy` features; confirm via the research's per-term correlation script that each
  feature now has non-zero variance and check its sign.
- **P1 — Linear model + gate (1–2 days):** `train.py`, `LearnedModel` table, CV-regularized Ridge/logistic,
  eval gate, serving integration with fallback. Ship only if it beats baseline.
- **P2 — Stretch (later, data-gated):** richer reward labels (implicit feedback), pairwise LambdaMART once
  multi-user data exists, periodic/auto retrain. **Blocked on more data (S3 multi-user) to be worth it.**

---

## 6. Honest caveats & decision points
- **Small data.** ~150 ratings from one user is *little*. A linear model can fix signs but won't be
  "Netflix-smart." Realistic P1 outcome: Pearson goes from −0.25 to *modestly positive* and NDCG rises — a
  real improvement and a working learning loop, not a miracle. **The big gains come with more users +
  collaborative filtering (S3), which S1 is the on-ramp to.**
- **Overfitting risk** on tiny data → mitigated by linear-first, L2 regularization, cross-validated `alpha`,
  and the time-split eval as the hard gate. If even a regularized linear model can't beat baseline, the
  honest conclusion is "the content features don't predict this user's fine-grained ratings; need implicit
  signals + more data," and we stop — the eval makes that call, not us.
- **Eval is a proxy.** It measures "rank the user's watched movies by predicted rating"; production also
  cares about surfacing *unseen* good movies. Treat a positive eval as necessary, not sufficient; watch the
  live `/analytics` CTR/acceptance after shipping.
- **Retrain cadence:** Phase 1 = on-demand (`python -m backend.train`) and/or when N new ratings accumulate.
  No need for nightly jobs at single-user scale.

---

## 7. Verification
- `venv/bin/pytest` green incl. new feature/model tests; `extract_features` proven deterministic and
  identical between train and serve paths.
- `venv/bin/python -m backend.train` prints baseline vs trained eval; model persisted **only** on improvement.
- `venv/bin/python -m backend.eval` (and `--model`) shows the promoted model's Pearson/NDCG beating −0.25/0.47.
- Live `GET /recommendations/` healthy with the learned model; falls back cleanly when no model/cold-start.
- `GET /analytics/model` reports the active model + its gated metrics.

---

## 8. One-paragraph pitch
Stop guessing weights. Pull feature extraction into one shared module, feed those features + your actual
ratings/clicks to a regularized linear model, let it learn the correct weights **and signs**, and ship it
**only if the eval we already built says it's better**. It folds the entire failed per-term backlog
(M4/M1/M3) into features the model weights correctly, it's interpretable and overfit-resistant on small
data, and it's the on-ramp to the real long-term win — collaborative filtering once the app is multi-user.

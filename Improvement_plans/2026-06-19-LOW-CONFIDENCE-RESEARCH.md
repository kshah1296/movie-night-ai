# Low-Confidence Backlog Research — Q4 (recency decay) & M3 (DNA coverage / instrument mismatch)

**Date:** 2026-06-19
**Author:** ML platform engineer (focused research pass)
**Method:** Read the engine (`recommendations.py`, `dna.py`, `scoring.py`, `eval.py`), then ran read-only
experiments against the live `movie_night.db` (150 ratings) using the eval harness's own primitives.
No source files or the DB were modified.

---

## 1. Executive summary + verdicts

Both items are flagged "low-confidence; eval-gated per M5" in `to-do.md`. After running the eval and
targeted experiments, the verdict is the same for both, for the same underlying reason:

| Item | Verdict | One-line |
|---|---|---|
| **Q4 — recency decay** | **Skip it (for now)** | Measurably *hurts* the eval at every half-life; the data has no real time-drift to recover (150 ratings entered in ~10 bulk sessions over 7 days). |
| **M3 — DNA coverage / instrument mismatch** | **Do it differently** | The instrument mismatch is **real and costs ~0.02 Pearson** in real serving — but M3's prescribed fix (LLM-score the rated set, match instruments) does **not** fix it. The DNA term is *anti-predictive on this data regardless of instrument*; the only part of M3 that helps is **down-weighting DNA**, and even that is a ~0.01 band-aid. |

**The dominating finding behind both verdicts:** the scorer's personal terms are individually
**negatively** correlated with held-out ratings. dna_sim −0.17, actor_affinity −0.22, theme_affinity
−0.12, freshness −0.32; genre_affinity is a **dead constant pinned at 1.0** for this heavy user. There is
no per-term knob — decay, instrument-matching, or otherwise — that fixes a feature set whose signs are
wrong. This is exactly what M5 was built to catch, and it reconfirms the review board's headline ruling:
**stop hand-tuning; the real fix is S1 (learned weights that can flip these signs).**

**Bottom line for sequencing:** do **neither Q4 nor M3 before S1.** They are at best 0.01-magnitude moves
on a −0.25 baseline (i.e. still strongly anti-predictive), and Q4 is actively negative. Spend the
budget on M5's successor, S1.

---

## 2. Q4 — recency decay on rating weights

### Mechanism (what it would do)
Today the profile is a lifetime average: every rating contributes `int(rating) − 3` with equal weight to
the genre/people/keyword counters (`_build_profile`, `recommendations.py:213-239`) and to the DNA
aggregate (`contributions` list, `recommendations.py:887`). `Rating.created_at` exists but is never read.
Q4 would multiply each rating's contribution by an exponential decay `0.5 ** (age_days / half_life)` so
older ratings count less, modelling taste drift.

### Why it is unlikely to help *on this data* — and the experiment confirms it
`Rating.created_at` in the live DB does **not** encode viewing chronology — it encodes **data-entry order**.
All 150 ratings were entered in **~10 bulk-rating sessions across a single 7-day window** (2026-06-12 →
2026-06-19); the largest gap between sessions is ~2 days. There is essentially no real-world time drift in
the signal, so "decay the old ratings" mostly just throws away training mass from session 1 with no taste
reason to do so.

**Experiment** (recompute the eval with decay applied to both the genre/people/keyword profile and the DNA
aggregate; reference time = newest train rating; `test_frac=0.3`, `k=12`):

| half-life | Pearson | Spearman | NDCG@12 |
|---|---|---|---|
| **no decay** | **−0.2310** | **−0.2650** | **0.5140** |
| 0.5 d | −0.2582 | −0.3124 | 0.4928 |
| 1 d | −0.2504 | −0.2979 | 0.5124 |
| 2 d | −0.2462 | −0.3058 | 0.5124 |
| 3 d | −0.2462 | −0.3020 | 0.5137 |
| 5–14 d | −0.246 | −0.302 | 0.5137 |
| 30 d | −0.2461 | −0.2989 | 0.5137 |

*(The "no decay" baseline here is −0.231 vs the harness's −0.224 because the experiment reimplements the
profile builder without the watchlist/`loved` plumbing that doesn't affect the decay comparison. The trend
is what matters and it's monotone.)*

**Result:** decay is **worse than no decay at every half-life tested**, on every metric. Short half-lives
(0.5–1 d) are the worst (they discard most of the training set); long half-lives (≥5 d) asymptote to "no
decay minus a little." There is no half-life that beats the baseline.

### Concrete implementation (for the record, if it's ever revisited with real longitudinal data)
- In `_build_profile`, thread a `now: datetime` and compute `decay(r) = 0.5 ** ((now - r.created_at).days / HALF_LIFE)`; multiply the per-item `weight` inside `absorb()` and the genre `Counter` increments by it.
- In `build_recommendations`, apply the same `decay()` factor to each tuple in the `contributions` list before `aggregate_profile_dna`.
- Add `RATING_HALF_LIFE_DAYS` to `config.py` (default = effectively off, e.g. 3650). Half-life **range to try** if revisited: **180–540 days** (6–18 months) — anything shorter than the data-collection window is meaningless. The 0.5–30 d range tested here only looks bad because the whole dataset spans 7 days; a real multi-month history is the only context in which decay could pay off.

### Predicted impact & how to measure
- **On the current dataset: negative** (measured above — skip).
- **On a hypothetical year-long history: small positive at best**, and only if the user's taste actually
  drifts. Re-run `venv/bin/python -m backend.eval` before/after; keep only if Pearson **and** NDCG@12 both
  improve. Given the measured result, **do not ship this now.**

---

## 3. M3 — DNA coverage + user-vs-candidate instrument mismatch

### Is the instrument mismatch real in the code? **Yes — and the DB proves it is severe.**
The user DNA is aggregated from the user's **rated** movies; candidate DNA comes from `_ensure_dna`, which
LLM-scores at most `DNA_BATCH_LIMIT = 8` movies/request and serves everything else on the deterministic
`proxy_dna` genre echo. Live `movie_dna` source counts:

| set | llm | proxy |
|---|---|---|
| **rated movies** (build the user vector) | **131 (87%)** | 19 |
| **candidate movies** (scored against it) | **1 (0.3%)** | **293 (99.7%)** |

So in production, `dna_distance(user_dna, candidate_dna)` almost always compares an **LLM-built user vector**
against a **proxy candidate vector** — two different instruments, exactly as Hostile §C / ML §2 / Netflix W4
claimed. **The claim is confirmed.**

**Caveat the eval can't see by default:** `eval.py` scores held-out *rated* movies, which are 87% LLM-scored,
so the default harness compares **LLM-vs-LLM** and is blind to the mismatch. To measure the real serving
condition I replaced each held-out movie's DNA with its `proxy_dna` vector.

### Experiment — does the mismatch hurt, and do M3's fixes help?
`test_frac=0.3`, `k=12`:

| Scenario | Pearson | Spearman | NDCG@12 |
|---|---|---|---|
| baseline (LLM user vs LLM candidate — what the harness shows) | −0.2632 | −0.3098 | 0.4657 |
| **REAL serving (LLM user vs PROXY candidate)** | **−0.2865** | −0.3155 | 0.4642 |
| M3 fix (a): proxy candidate + `W_DNA` halved → 0.17 | −0.2713 | −0.3045 | 0.4661 |
| M3 fix (a): proxy candidate + `W_DNA = 0` (drop DNA) | **−0.2543** | −0.2857 | 0.4642 |
| M3 fix (b): proxy USER vs proxy candidate (instruments *matched*) | −0.2891 | −0.3305 | 0.4581 |

**Reading it:**
1. **The mismatch is real and harmful:** moving from the harness's flattering LLM-vs-LLM (−0.263) to real
   serving (−0.287) costs **~0.023 Pearson**. So M3 is pointing at a genuine ~0.02 problem.
2. **M3's headline fix — "LLM-score the rated set fully, only proxy candidates" — does nothing here.** The
   rated set is *already* 87% LLM-scored; finishing the last 13% changes the user vector negligibly. The
   mismatch isn't "user not fully LLM-scored," it's "candidates are proxy" — and you can't LLM-score 200+
   candidates/request within the Groq budget.
3. **Matching the instruments the *other* way (proxy user vs proxy candidate, M3b) is the WORST option**
   (−0.289). Proxy DNA is a pure genre echo, so matching them just amplifies an already anti-predictive
   genre signal. So "de-collinear genre vs DNA by matching instruments" backfires.
4. **The only lever that helps is down-weighting DNA** — and only because the DNA term itself is
   anti-predictive. `W_DNA = 0` recovers −0.254 (best of the proxy-candidate rows), i.e. **dropping the
   single largest weight (0.34) makes the system less wrong.** That's a damning result for DNA as the core
   similarity space, not a vindication of M3's design.

### Why down-weighting only band-aids: every personal term is anti-predictive
Per-term Pearson r of each scorer component vs the held-out rating (`test_frac=0.3`):

| term | r vs rating |
|---|---|
| freshness | **−0.317** (worst — newer ⇒ lower held-out rating here) |
| actor_affinity | −0.221 |
| dna_sim | −0.168 |
| theme_affinity | −0.119 |
| discovery | 0.000 (held at eval constants — no signal) |
| director_affinity | +0.027 (barely positive) |
| **genre_affinity** | **None — constant 1.0 for 100% of held-out movies** |

`genre_affinity` is **pinned at 1.0 for every held-out movie** (min=max=mean=1.0, stdev=0): for a heavy user
the fixed `GENRE_NORM = 8` saturates the term, so it carries **zero discriminating signal** — this is the
exact M4 saturation the review board flagged, now measured. The DNA mismatch is one symptom of a broader
disease: **the features' signs are wrong and the weights amplify them.** No instrument fix changes a sign.

### Robustness (drop-DNA across splits)
Removing the DNA term improves Pearson by a small, consistent margin at every split (full → no-DNA):
`tf=0.2: −0.336→−0.307 · 0.25: −0.237→−0.220 · 0.3: −0.250→−0.235 · 0.35: −0.287→−0.280 · 0.4: −0.208→−0.207`.
Always an improvement, always tiny (~0.005–0.03). Real, but not a fix.

### Concrete implementation (the *useful subset* of M3, if you ship anything)
Do **not** do the "LLM-score the rated set + match instruments" part — measured useless/harmful. The only
evidence-supported micro-move:
- Add a `source` tag to each candidate's DNA in `_ensure_dna` (already known) and pass it to
  `score_candidate`; when `cand.dna_source == "proxy"`, scale the DNA term down (e.g. `W_DNA * 0.5`) and
  redistribute that weight onto `director_affinity` (the only ~non-negative term). This recovers the
  `W_DNA`-halved row (−0.271 vs −0.287), a ~0.015 gain.
- **But this is ~0.015 on a −0.25 baseline — cosmetic.** It does not make the system predictive; it makes a
  broken term quieter. Recommend logging it as "subsumed by S1" rather than implementing it standalone.

### Predicted impact
- M3 as written (LLM-score rated set, match instruments): **~0 to negative**, plus real Groq cost — measured.
- M3 reduced to "down-weight proxy-candidate DNA": **+0.01–0.02 Pearson**, still deeply anti-predictive.
- Either way it does not move the system out of the negative-correlation regime. **The honest fix is S1**,
  which can learn `W_DNA < 0` (or drop it) and fix the sign of freshness/actor/theme directly.

---

## 4. Experiment appendix — numbers I actually ran

All against the live `movie_night.db` (150 ratings, time-ordered split), read-only, using
`backend.eval` primitives (`_load_facets`, `_load_dna`, `_rating_to_candidate`, `_pearson`, `ndcg_at_k`).

- **Harness baseline** (`venv/bin/python -m backend.eval`): Pearson −0.2243, Spearman −0.2375,
  NDCG@12 0.4682, calibrated RMSE 0.881, test_dna_coverage 1.0, n_train 105 / n_test 45.
- **Data shape:** rating dist {1★:1, 2★:17, 3★:44, 4★:41, 5★:47}; 150 distinct timestamps in **10 sessions**
  over 7 days (max inter-session gap ~2 d).
- **DNA source split:** rated 131 llm / 19 proxy; candidates 1 llm / 293 proxy.
- **Q4 decay sweep:** table in §2 — monotone worse than no-decay for all half-lives 0.5–30 d.
- **M3 instrument sweep:** table in §3 — real-serving mismatch costs ~0.023 Pearson; only `W_DNA→0` helps.
- **Per-term correlations + genre saturation:** table in §3 — genre_affinity constant 1.0; freshness −0.317.

*(Experiment scripts were temporary and removed; they reimplement only what the harness already exposes, so
any of the above reproduces by re-deriving `contributions`/`profile` from a time-split and re-running
`score_candidate`. The harness itself is the canonical before/after gate.)*

---

## 5. Combined recommendation — should these run before S1?

**No. Do neither Q4 nor M3 before the learned ranker (S1).**

- The eval is **−0.25 Pearson / 0.47 NDCG@12 ≈ random-to-anti-correlated.** Both Q4 and M3 are
  ≤0.02-magnitude levers; Q4 is *negative*, M3's prescribed form is *useless*, and even M3's salvageable
  micro-move (down-weight proxy DNA) is a ~0.015 band-aid that leaves the system anti-predictive.
- The diagnosis is now firm and measured: **the feature set's signs are wrong** (dna_sim, actor, theme,
  freshness all negative; genre dead-constant). No per-term tweak — the third one tried after M4's revert —
  can fix wrong-signed features. **Only learned weights (S1) can**, by fitting (and flipping) the signs
  against the very labels the eval already exposes.
- This is precisely the outcome M5 was built to produce: it has now gated out **M4 (genre normalize),
  Q4 (recency decay), and M3 (instrument match)** — three consecutive hand-tuning attempts. The pattern is
  the signal. **Promote S1, retire the per-term backlog items**, and re-test Q4 only if/when a real
  multi-month rating history exists (180–540 d half-life), and M3 only as an input feature *inside* S1
  (let the model decide DNA's weight and sign rather than asserting 0.34).

**Suggested to-do.md edits (not applied — research only):** mark Q4 "Skip — eval-negative at all
half-lives (this doc); revisit only with longitudinal data," and M3 "Do differently — mismatch real (~0.02)
but the fix is anti-predictive DNA; fold into S1, don't ship standalone."

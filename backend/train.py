"""Learned ranker training (S1) — fits a standardized linear model over `features.FEATURE_NAMES`
and persists it as the active `LearnedModel` ONLY if it beats the hand-tuned scorer on the offline
eval (the M5 gate). The hand-tuned weights stay the fallback, so a bad train can never ship.

Why this exists: the eval showed the hand-tuned feature *signs* are anti-predictive (Pearson ≈ −0.15).
Per-term tweaks couldn't fix it; only learned weights can. This is a tiny problem (~150 ratings,
10 features), so it's a closed-form numpy Ridge — no scikit-learn dependency.

Method (leak-aware):
  • Training features are built **leave-one-out**: each rated movie is scored as a candidate against
    a profile rebuilt from every OTHER rating. That mirrors serving exactly (a candidate is never in
    its own profile) and removes the trivial "its own genre is in loved_genres" leak.
  • The GATE uses the eval's time-split: fit on the train rows (LOO), score the held-out test rows,
    compare Pearson to the hand-tuned baseline on the *same* split. Alpha is chosen by k-fold CV on
    the train matrix (no peeking at the gate test set).
  • If it passes, the production model is refit on ALL ratings (LOO) with the chosen alpha and stored
    active; the stored metrics are the honest gated-split numbers.

Run:   venv/bin/python -m backend.train [--test-frac 0.3] [--k 12] [--dry-run]
"""
import argparse
import json
from typing import Dict, List, Optional, Tuple

import numpy as np

from backend.database import SessionLocal
from backend.models import LearnedModel, MovieFacets, MovieDNA, Rating
from backend import dna as dna_mod
from backend import eval as eval_mod
from backend.features import FEATURE_NAMES, extract_features
from backend.routers.recommendations import _build_profile

MODEL_VERSION = "s1-ridge-1"
ALPHAS = [0.1, 0.3, 1.0, 3.0, 10.0, 30.0, 100.0]
CV_FOLDS = 5


def _build_loo_matrix(rows: List[Rating], facets: Dict[int, dict],
                      dnas: Dict[int, dict]) -> Tuple[np.ndarray, np.ndarray]:
    """Leave-one-out feature matrix: row i = features of rating i scored against the profile
    built from all OTHER rows. y = the star rating. No self-leakage (matches serving)."""
    X: List[List[float]] = []
    y: List[float] = []
    for i, r in enumerate(rows):
        others = rows[:i] + rows[i + 1:]
        profile = _build_profile(others, [], facets)
        contributions = [(int(o.rating) - 3, dnas.get(o.tmdb_id, {}).get("axes", {})) for o in others]
        user_dna, confidence = dna_mod.aggregate_profile_dna(contributions)
        cand = eval_mod._rating_to_candidate(r, facets, dnas)
        feats = extract_features(cand, profile, user_dna, confidence)
        X.append([feats[name] for name in FEATURE_NAMES])
        y.append(float(r.rating))
    return np.array(X, dtype=float), np.array(y, dtype=float)


def _fit_ridge(X: np.ndarray, y: np.ndarray, alpha: float) -> dict:
    """Standardized closed-form Ridge → a model dict consumable by features.apply_model."""
    mean = X.mean(axis=0)
    std = X.std(axis=0)
    std_safe = np.where(std > 1e-9, std, 1.0)
    Z = (X - mean) / std_safe
    ymean = float(y.mean())
    yc = y - ymean
    n_feat = Z.shape[1]
    A = Z.T @ Z + alpha * np.eye(n_feat)
    coef = np.linalg.solve(A, Z.T @ yc)
    return {
        "features": list(FEATURE_NAMES),
        "coef": [float(c) for c in coef],
        "mean": [float(m) for m in mean],
        "std": [float(s) for s in std_safe],
        "intercept": ymean,
        "model_version": MODEL_VERSION,
    }


def _predict(model: dict, X: np.ndarray) -> np.ndarray:
    mean = np.array(model["mean"]); std = np.array(model["std"])
    Z = (X - mean) / std
    return model["intercept"] + Z @ np.array(model["coef"])


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 3 or a.std() < 1e-12 or b.std() < 1e-12:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def _pick_alpha_cv(X: np.ndarray, y: np.ndarray) -> float:
    """k-fold CV on the training matrix, choosing the alpha with the best mean fold Pearson.
    No peeking at the gate test set — alpha is selected from train data only."""
    n = len(y)
    if n < CV_FOLDS * 2:
        return 1.0
    rng = np.random.RandomState(42)
    folds = np.array_split(rng.permutation(n), CV_FOLDS)
    best_alpha, best_score = 1.0, -2.0
    for alpha in ALPHAS:
        scores = []
        for f in folds:
            mask = np.ones(n, dtype=bool); mask[f] = False
            if mask.sum() < len(FEATURE_NAMES) + 1:
                continue
            m = _fit_ridge(X[mask], y[mask], alpha)
            scores.append(_pearson(_predict(m, X[f]), y[f]))
        if scores and np.mean(scores) > best_score:
            best_score, best_alpha = float(np.mean(scores)), alpha
    return best_alpha


def train(db, test_frac: float = 0.3, k: int = 12) -> dict:
    rows = db.query(Rating).order_by(Rating.created_at, Rating.id).all()
    ids = [r.tmdb_id for r in rows]
    facets = eval_mod._load_facets(db, ids)
    dnas = eval_mod._load_dna(db, ids)

    train_rows, test_rows = eval_mod.split_ratings(rows, test_frac)
    if not train_rows or not test_rows:
        return {"error": "not enough ratings to train+gate", "n_ratings": len(rows)}

    # 1) Pick alpha by CV on the train split (no test leakage), fit the gate model on train.
    X_tr, y_tr = _build_loo_matrix(train_rows, facets, dnas)
    alpha = _pick_alpha_cv(X_tr, y_tr)
    gate_model = _fit_ridge(X_tr, y_tr, alpha)

    # 2) Gate: compare to the hand-tuned baseline on the SAME held-out test rows.
    baseline = eval_mod.run_eval(db, test_frac=test_frac, k=k, model=None)
    learned = eval_mod.run_eval(db, test_frac=test_frac, k=k, model=gate_model)
    base_p = baseline.get("pearson_r") or 0.0
    learn_p = learned.get("pearson_r") or 0.0
    passed = learn_p > base_p

    result = {
        "model_version": MODEL_VERSION, "alpha": alpha,
        "n_ratings": len(rows), "n_train": len(train_rows), "n_test": len(test_rows),
        "baseline_pearson": base_p, "learned_pearson": learn_p,
        "baseline_ndcg": baseline.get(f"ndcg_at_{k}"), "learned_ndcg": learned.get(f"ndcg_at_{k}"),
        "baseline_spearman": baseline.get("spearman_r"), "learned_spearman": learned.get("spearman_r"),
        "passed_gate": passed,
        "weights": dict(zip(FEATURE_NAMES, gate_model["coef"])),
    }
    result["model"] = gate_model
    result["metrics"] = {
        "pearson": learn_p, "spearman": learned.get("spearman_r"),
        "ndcg": learned.get(f"ndcg_at_{k}"), "baseline_pearson": base_p,
        "alpha": alpha, "test_frac": test_frac,
    }
    return result


def persist(db, result: dict) -> int:
    """Refit on ALL ratings (LOO) with the gated alpha and store as the single active model."""
    rows = db.query(Rating).order_by(Rating.created_at, Rating.id).all()
    ids = [r.tmdb_id for r in rows]
    facets = eval_mod._load_facets(db, ids)
    dnas = eval_mod._load_dna(db, ids)
    X, y = _build_loo_matrix(rows, facets, dnas)
    prod = _fit_ridge(X, y, result["alpha"])

    db.query(LearnedModel).filter(LearnedModel.active == True).update(  # noqa: E712
        {LearnedModel.active: False})
    row = LearnedModel(
        model_version=MODEL_VERSION,
        features=json.dumps(prod["features"]),
        coef=json.dumps(prod["coef"]),
        mean=json.dumps(prod["mean"]),
        std=json.dumps(prod["std"]),
        intercept=prod["intercept"],
        metrics=json.dumps(result["metrics"]),
        active=True,
    )
    db.add(row)
    db.commit()
    return row.id


def main() -> None:
    ap = argparse.ArgumentParser(description="Train + gate the S1 learned ranker")
    ap.add_argument("--test-frac", type=float, default=0.3)
    ap.add_argument("--k", type=int, default=12)
    ap.add_argument("--dry-run", action="store_true", help="train + gate, but never persist")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        result = train(db, test_frac=args.test_frac, k=args.k)
        if "error" in result:
            print(json.dumps(result, indent=2)); return
        printable = {k: v for k, v in result.items() if k != "model"}
        if result["passed_gate"] and not args.dry_run:
            mid = persist(db, result)
            printable["persisted_model_id"] = mid
            printable["status"] = "ACTIVE — beats baseline, now serving"
        elif result["passed_gate"]:
            printable["status"] = "PASSED gate (dry-run, not persisted)"
        else:
            printable["status"] = "REJECTED — does not beat hand-tuned baseline; nothing changed"
        print(json.dumps(printable, indent=2))
    finally:
        db.close()


if __name__ == "__main__":
    main()

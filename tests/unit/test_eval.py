"""Unit tests for the pure metric math in backend/eval.py (M5 harness)."""
import math

from backend.eval import (
    ndcg_at_k, calibrated_rmse, _pearson, _spearman, _avg_ranks,
)


# ── NDCG ──

def test_ndcg_perfect_ranking_is_one():
    # already in descending relevance order
    assert math.isclose(ndcg_at_k([3, 2, 1, 0], 4), 1.0)


def test_ndcg_worst_ranking_below_one():
    assert ndcg_at_k([0, 1, 2, 3], 4) < 1.0


def test_ndcg_all_zero_relevance_is_none():
    assert ndcg_at_k([0, 0, 0], 3) is None


def test_ndcg_respects_k():
    # truncating to k=1 with the top item perfect → 1.0
    assert math.isclose(ndcg_at_k([3, 0, 0, 0], 1), 1.0)


# ── Spearman ──

def test_spearman_monotonic_is_one():
    r = _spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])
    assert r is not None and abs(r - 1.0) < 1e-9


def test_spearman_reversed_is_minus_one():
    r = _spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])
    assert r is not None and abs(r + 1.0) < 1e-9


def test_spearman_too_few_points_is_none():
    assert _spearman([1, 2], [1, 2]) is None


def test_avg_ranks_handles_ties():
    # two tied values share the average of their ranks
    assert _avg_ranks([5, 5, 9]) == [0.5, 0.5, 2.0]


# ── calibrated RMSE ──

def test_calibrated_rmse_perfect_linear_is_zero():
    preds = [0.1, 0.2, 0.3, 0.4]
    actuals = [1.0, 2.0, 3.0, 4.0]  # exactly linear in preds
    rmse = calibrated_rmse(preds, actuals)
    assert rmse is not None and rmse < 1e-9


def test_calibrated_rmse_constant_preds_is_none():
    assert calibrated_rmse([0.5, 0.5, 0.5], [1, 2, 3]) is None


# ── Pearson (eval's local copy) ──

def test_pearson_perfect_positive():
    r = _pearson([1, 2, 3, 4], [2, 4, 6, 8])
    assert r is not None and abs(r - 1.0) < 1e-9


def test_pearson_zero_variance_is_none():
    assert _pearson([3, 3, 3, 3], [1, 2, 3, 4]) is None

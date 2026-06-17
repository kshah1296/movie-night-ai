"""Unit tests for the metric math in backend/routers/analytics.py."""
from backend.routers import analytics


def test_pearson_perfect_positive():
    r = analytics._pearson([1, 2, 3, 4], [2, 4, 6, 8])
    assert r is not None and abs(r - 1.0) < 1e-9


def test_pearson_perfect_negative():
    r = analytics._pearson([1, 2, 3, 4], [8, 6, 4, 2])
    assert r is not None and abs(r + 1.0) < 1e-9


def test_pearson_too_few_points_returns_none():
    assert analytics._pearson([1, 2], [1, 2]) is None


def test_pearson_zero_variance_returns_none():
    assert analytics._pearson([5, 5, 5, 5], [1, 2, 3, 4]) is None


def test_rate_guards_zero_denominator():
    assert analytics._rate(3, 0) is None


def test_rate_rounds():
    assert analytics._rate(1, 3) == 0.333


def test_rate_basic():
    assert analytics._rate(1, 4) == 0.25

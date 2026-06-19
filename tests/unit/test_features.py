"""Unit tests for backend/features.py — the shared train/serve feature extractor (S1)
and the standardized-linear model application. Pure, no DB/network."""
import math

from backend.dna import zero_vector
from backend.features import FEATURE_NAMES, extract_features, apply_model


def _profile():
    return {
        "loved_genres": {18: 6, 53: 3},      # Drama, Thriller
        "disliked_genres": {27: 4},          # Horror
        "people_scores": {101: 5, 202: 3},
        "top_keywords": ["slow burn", "grief"],
        "avoid_keywords": ["gore"],
    }


def _user_dna():
    d = zero_vector()
    d.update({"pace": -0.8, "focus": 0.8})
    return d


def _conf():
    c = zero_vector()
    c.update({"pace": 0.8, "focus": 0.8})
    return c


def _cand(**over):
    base = {
        "tmdb_id": 1, "year": 2012, "genre_ids": [18], "vote_average": 7.4, "vote_count": 800,
        "directors": [[101, "Dir"]], "top_cast": [[202, "Actor"]],
        "themes": ["grief"], "keywords": ["slow burn"], "dna": zero_vector(),
    }
    base.update(over)
    return base


def test_extract_returns_all_named_features():
    feats = extract_features(_cand(), _profile(), _user_dna(), _conf())
    assert set(feats.keys()) == set(FEATURE_NAMES)
    # every clamped feature stays within sane bounds
    for name in ("dna_sim", "genre_affinity", "genre_affinity_norm", "director_affinity",
                 "actor_affinity", "theme_affinity", "freshness", "discovery", "pop_penalty"):
        assert 0.0 <= feats[name] <= 1.0


def test_dna_is_proxy_flag():
    assert extract_features(_cand(dna_source="llm"), _profile(), _user_dna(), _conf())["dna_is_proxy"] == 0.0
    assert extract_features(_cand(dna_source="proxy"), _profile(), _user_dna(), _conf())["dna_is_proxy"] == 1.0
    # proxy-transient and missing both count as proxy (not LLM-scored)
    assert extract_features(_cand(dna_source="proxy-transient"), _profile(), _user_dna(), _conf())["dna_is_proxy"] == 1.0
    assert extract_features(_cand(), _profile(), _user_dna(), _conf())["dna_is_proxy"] == 1.0


def test_genre_affinity_rewards_loved_penalizes_disliked():
    loved = extract_features(_cand(genre_ids=[18]), _profile(), _user_dna(), _conf())["genre_affinity"]
    disliked = extract_features(_cand(genre_ids=[27]), _profile(), _user_dna(), _conf())["genre_affinity"]
    assert loved > disliked


def test_people_affinity_picks_up_loved_director_and_actor():
    f = extract_features(_cand(), _profile(), _user_dna(), _conf())
    assert f["director_affinity"] > 0.0
    assert f["actor_affinity"] > 0.0
    # an unknown person scores zero affinity
    cold = extract_features(_cand(directors=[[999, "X"]], top_cast=[[888, "Y"]]),
                            _profile(), _user_dna(), _conf())
    assert cold["director_affinity"] == 0.0


def test_apply_model_is_standardized_linear():
    # one feature, mean 0.5 / std 0.5, coef 2, intercept 1 → at x=1.0: 1 + 2*((1-0.5)/0.5) = 3
    model = {"features": ["dna_sim"], "coef": [2.0], "mean": [0.5], "std": [0.5], "intercept": 1.0}
    assert math.isclose(apply_model(model, {"dna_sim": 1.0}), 3.0)
    # at the mean the standardized term is zero → just the intercept
    assert math.isclose(apply_model(model, {"dna_sim": 0.5}), 1.0)


def test_apply_model_guards_zero_std_and_missing_feature():
    # std 0 is treated as 1.0 so it never divides by zero (a constant feature has x==mean
    # in practice → still contributes 0); a feature absent from the dict defaults to 0.0.
    model = {"features": ["a", "b"], "coef": [5.0, 5.0], "mean": [0.0, 0.0],
             "std": [0.0, 1.0], "intercept": 0.0}
    # "a": std→1.0 so 5*(9-0)/1 = 45 ; "b" missing → 0.0 so 5*(0-0)/1 = 0
    assert math.isclose(apply_model(model, {"a": 9.0}), 45.0)
    # a constant feature (x == mean) contributes nothing regardless of the std guard
    const = {"features": ["a"], "coef": [5.0], "mean": [0.5], "std": [0.0], "intercept": 1.0}
    assert math.isclose(apply_model(const, {"a": 0.5}), 1.0)

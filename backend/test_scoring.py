"""Deterministic tests for the recommendation scorer + bucketing + MMR diversity.
Run: venv/bin/pytest backend/test_scoring.py"""
from backend.dna import zero_vector
from backend.scoring import (
    score_candidate, assign_bucket, select_with_buckets_mmr,
    CAP_DIRECTOR, CAP_GENRE,
)


def _profile():
    return {
        "loved_genres": {18: 5, 53: 3},      # Drama, Thriller
        "disliked_genres": {27: 4},          # Horror
        "people_scores": {},
        "top_keywords": ["slow burn", "grief"],
        "avoid_keywords": ["gore"],
    }


def _user_dna():
    d = zero_vector()
    d.update({"pace": -0.8, "focus": 0.8, "mode": -0.7, "complexity": 0.6})  # slow, character, cerebral
    return d


def _conf():
    c = zero_vector()
    c.update({"pace": 0.8, "focus": 0.8, "mode": 0.8, "complexity": 0.7})
    return c


def _cand(tmdb_id, dna=None, **over):
    base = {
        "tmdb_id": tmdb_id, "title": f"M{tmdb_id}", "year": 2010,
        "genres": ["Drama"], "genre_ids": [18], "vote_average": 7.2, "vote_count": 1200,
        "directors": [], "top_cast": [], "themes": [], "keywords": [],
        "dna": dna or zero_vector(), "channel": "popular",
    }
    base.update(over)
    return base


def test_matching_dna_outscores_opposite():
    p, ud, cf = _profile(), _user_dna(), _conf()
    match = _cand(1, dna={**zero_vector(), "pace": -0.8, "focus": 0.8, "mode": -0.7, "complexity": 0.6})
    opposite = _cand(2, dna={**zero_vector(), "pace": 0.8, "focus": -0.8, "mode": 0.7, "complexity": -0.6})
    s_match, _ = score_candidate(match, p, ud, cf)
    s_opp, _ = score_candidate(opposite, p, ud, cf)
    assert s_match > s_opp


def test_score_is_deterministic():
    p, ud, cf = _profile(), _user_dna(), _conf()
    c = _cand(7)
    assert score_candidate(c, p, ud, cf, seed=3)[0] == score_candidate(c, p, ud, cf, seed=3)[0]


def test_underseen_bucket():
    c = _cand(3, vote_average=7.4, vote_count=200)
    _, comps = score_candidate(c, _profile(), _user_dna(), _conf())
    bucket, _reason = assign_bucket(c, comps)
    assert bucket == "Underseen Favorites"


def test_wildcard_bucket_from_channel():
    c = _cand(4, channel="wildcard")
    _, comps = score_candidate(c, _profile(), _user_dna(), _conf())
    assert assign_bucket(c, comps)[0] == "Wildcard"


def test_director_cap():
    # 6 share director 99, 14 have unique directors; no genres/years so only the
    # director cap can bind. Selecting 12 must include at most CAP_DIRECTOR of dir 99.
    pool = []
    for i in range(1, 7):
        pool.append(_cand(i, directors=[[99, "Shared"]], genres=[], genre_ids=[], year=None,
                          bucket="Safe Picks", score=1.0 - i * 0.01))
    for i in range(7, 21):
        pool.append(_cand(i, directors=[[100 + i, "Solo"]], genres=[], genre_ids=[], year=None,
                          bucket="Safe Picks", score=0.5 - i * 0.001))
    picked = select_with_buckets_mmr(pool, n=12)
    assert len(picked) == 12
    shared = sum(1 for c in picked if c["directors"] and c["directors"][0][0] == 99)
    assert shared <= CAP_DIRECTOR


def test_genre_cap():
    others = ["Comedy", "Horror", "Action", "Western", "War", "Music", "History"]
    pool = []
    for i in range(1, 7):
        pool.append(_cand(i, genres=["Drama"], year=None, bucket="Safe Picks", score=1.0 - i * 0.01))
    for i in range(7, 21):
        g = others[i % len(others)]
        pool.append(_cand(i, genres=[g], year=None, bucket="Safe Picks", score=0.5 - i * 0.001))
    picked = select_with_buckets_mmr(pool, n=12)
    drama = sum(1 for c in picked if (c["genres"] or [None])[0] == "Drama")
    assert drama <= CAP_GENRE

"""Unit tests for backend/scoring.py — hybrid scorer, bucketing, MMR diversity."""
from backend.dna import zero_vector
from backend.scoring import (
    score_candidate, assign_bucket, select_with_buckets_mmr,
    CAP_DIRECTOR, CAP_GENRE, CAP_DECADE, BUCKET_MIX,
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
    d.update({"pace": -0.8, "focus": 0.8, "mode": -0.7, "complexity": 0.6})
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


# ── score_candidate ──

def test_matching_dna_outscores_opposite():
    p, ud, cf = _profile(), _user_dna(), _conf()
    match = _cand(1, dna={**zero_vector(), "pace": -0.8, "focus": 0.8, "mode": -0.7, "complexity": 0.6})
    opposite = _cand(2, dna={**zero_vector(), "pace": 0.8, "focus": -0.8, "mode": 0.7, "complexity": -0.6})
    assert score_candidate(match, p, ud, cf)[0] > score_candidate(opposite, p, ud, cf)[0]


def test_genre_match_outscores_disliked_genre():
    p, ud, cf = _profile(), _user_dna(), _conf()
    loved = _cand(1, genres=["Drama"], genre_ids=[18])
    disliked = _cand(2, genres=["Horror"], genre_ids=[27])
    assert score_candidate(loved, p, ud, cf)[0] > score_candidate(disliked, p, ud, cf)[0]


def test_director_affinity_boosts_score():
    p, ud, cf = _profile(), _user_dna(), _conf()
    p["people_scores"] = {99: 6}
    with_dir = _cand(1, directors=[[99, "Fav Director"]])
    without = _cand(2, directors=[[42, "Nobody"]])
    assert score_candidate(with_dir, p, ud, cf)[0] > score_candidate(without, p, ud, cf)[0]


def test_score_is_deterministic_for_same_seed():
    p, ud, cf = _profile(), _user_dna(), _conf()
    c = _cand(7)
    assert score_candidate(c, p, ud, cf, seed=3)[0] == score_candidate(c, p, ud, cf, seed=3)[0]


def test_components_exposed_for_bucketing():
    _s, comps = score_candidate(_cand(1), _profile(), _user_dna(), _conf())
    for key in ("dna_sim", "genre_affinity", "discovery", "pop_penalty", "diff_axes"):
        assert key in comps


# ── assign_bucket ──

def test_underseen_bucket():
    c = _cand(3, vote_average=7.4, vote_count=200)
    _s, comps = score_candidate(c, _profile(), _user_dna(), _conf())
    assert assign_bucket(c, comps)[0] == "Underseen Favorites"


def test_hidden_gems_bucket():
    c = _cand(3, vote_average=7.2, vote_count=1500,
              dna={**zero_vector(), "pace": -0.8, "focus": 0.8})
    _s, comps = score_candidate(c, _profile(), _user_dna(), _conf())
    assert assign_bucket(c, comps)[0] == "Hidden Gems"


def test_critically_acclaimed_bucket():
    # high vote, very high vote_count, but DNA mismatch keeps it out of Hidden Gems
    c = _cand(3, vote_average=8.2, vote_count=9000,
              dna={**zero_vector(), "pace": 0.9, "focus": -0.9})
    _s, comps = score_candidate(c, _profile(), _user_dna(), _conf())
    assert assign_bucket(c, comps)[0] == "Critically Acclaimed"


def test_wildcard_bucket_from_channel():
    c = _cand(4, channel="wildcard")
    _s, comps = score_candidate(c, _profile(), _user_dna(), _conf())
    assert assign_bucket(c, comps)[0] == "Wildcard"


def test_every_candidate_gets_a_bucket():
    c = _cand(5, vote_average=6.0, vote_count=8000,
              dna={**zero_vector(), "tone": 0.1})
    _s, comps = score_candidate(c, _profile(), _user_dna(), _conf())
    bucket, reason = assign_bucket(c, comps)
    assert bucket and reason


# ── select_with_buckets_mmr ──

def _pool(n_shared_dir=0, n_shared_genre=0, total=20):
    others = ["Comedy", "Horror", "Action", "Western", "War", "Music", "History"]
    pool = []
    for i in range(1, total + 1):
        directors = [[99, "Shared"]] if i <= n_shared_dir else [[100 + i, "Solo"]]
        genres = ["Drama"] if i <= n_shared_genre else [others[i % len(others)]]
        pool.append(_cand(i, directors=directors, genres=genres, year=None,
                          bucket="Safe Picks", score=1.0 - i * 0.001))
    return pool


def test_director_cap_enforced():
    picked = select_with_buckets_mmr(_pool(n_shared_dir=6), n=12)
    assert len(picked) == 12
    shared = sum(1 for c in picked if c["directors"] and c["directors"][0][0] == 99)
    assert shared <= CAP_DIRECTOR


def test_genre_cap_enforced():
    picked = select_with_buckets_mmr(_pool(n_shared_genre=6), n=12)
    drama = sum(1 for c in picked if (c["genres"] or [None])[0] == "Drama")
    assert drama <= CAP_GENRE


def test_decade_cap_enforced():
    # 8 high-scoring 2010s movies, plus 18 others spread 2-per-decade across 9 OTHER
    # decades — enough to fill 12 without ever needing a 3rd from the 2010s.
    pool = []
    for i in range(1, 9):
        pool.append(_cand(i, year=2011 + (i % 5), genres=[], bucket="Safe Picks", score=1.0 - i * 0.001))
    cid = 100
    for decade in (1940, 1950, 1960, 1970, 1980, 1990, 2000, 2020, 2030):
        for k in range(2):
            pool.append(_cand(cid, year=decade + k, genres=[], bucket="Safe Picks",
                              score=0.5 - cid * 0.0001))
            cid += 1
    picked = select_with_buckets_mmr(pool, n=12)
    tens = sum(1 for c in picked if isinstance(c["year"], int) and (c["year"] // 10) * 10 == 2010)
    assert tens <= CAP_DECADE


def test_select_returns_at_most_n():
    picked = select_with_buckets_mmr(_pool(total=30), n=12)
    assert len(picked) == 12


def test_select_empty_pool_returns_empty():
    assert select_with_buckets_mmr([], n=12) == []


def test_select_handles_fewer_than_n():
    picked = select_with_buckets_mmr(_pool(total=5), n=12)
    assert len(picked) == 5


def test_bucket_mix_sums_to_twelve():
    assert sum(BUCKET_MIX.values()) == 12

"""Unit tests for the pure logic in backend/routers/recommendations.py:
the weighted taste profile, the deterministic anchor, and the template explanation."""
import json
from types import SimpleNamespace

from backend.dna import zero_vector
from backend.routers import recommendations as rec


def _rating(tmdb_id, rating, genres, title="M", year=2010):
    return SimpleNamespace(tmdb_id=tmdb_id, rating=rating,
                           genres=json.dumps(genres), title=title, year=year)


def _facet(keywords=None, director=(10, "Dir"), actor=(20, "Actor"), year=2010, lang="en"):
    return {
        "keywords": keywords or [],
        "directors": [[director[0], director[1]]],
        "top_cast": [[actor[0], actor[1]]],
        "original_language": lang,
        "runtime": 120,
        "year": year,
    }


# ── _build_profile ──

def test_build_profile_separates_loved_and_disliked_genres():
    ratings = [
        _rating(1, 5, ["Action", "Thriller"]),
        _rating(2, 5, ["Action"]),
        _rating(3, 1, ["Horror"]),
    ]
    facets = {1: _facet(), 2: _facet(), 3: _facet()}
    p = rec._build_profile(ratings, [], facets)
    assert rec.GENRE_NAME_TO_ID["Action"] in p["loved_genres"]
    assert rec.GENRE_NAME_TO_ID["Horror"] in p["disliked_genres"]


def test_build_profile_extracts_recurring_keywords():
    ratings = [_rating(1, 5, ["Action"]), _rating(2, 5, ["Action"])]
    facets = {1: _facet(keywords=["heist", "revenge"]),
              2: _facet(keywords=["heist", "betrayal"])}
    p = rec._build_profile(ratings, [], facets)
    assert "heist" in p["top_keywords"]   # appears in both loved films


def test_build_profile_surfaces_loved_people_and_scores():
    ratings = [_rating(1, 5, ["Action"]), _rating(2, 5, ["Action"])]
    facets = {1: _facet(director=(10, "Fav Dir")), 2: _facet(director=(10, "Fav Dir"))}
    p = rec._build_profile(ratings, [], facets)
    assert 10 in p["people_scores"]
    assert p["people_scores"][10] > 0
    assert any(pid == 10 for pid, _name, _role in p["loved_people"])


def test_build_profile_infers_favorite_decade():
    ratings = [_rating(i, 5, ["Drama"]) for i in range(1, 4)]
    facets = {i: _facet(year=2015) for i in range(1, 4)}
    p = rec._build_profile(ratings, [], facets)
    assert p["top_decade"] == 2010


def test_build_profile_empty_is_safe():
    p = rec._build_profile([], [], {})
    assert p["loved_genres"] == {} or len(p["loved_genres"]) == 0
    assert p["top_keywords"] == []
    assert p["people_scores"] == {}


# ── _nearest_loved_anchor ──

def test_nearest_loved_anchor_picks_closest():
    cand = {**zero_vector(), "pace": 0.7}
    loved = [("Slow Film", {**zero_vector(), "pace": -0.8}),
             ("Fast Film", {**zero_vector(), "pace": 0.7})]
    assert rec._nearest_loved_anchor(cand, loved) == "Fast Film"


def test_nearest_loved_anchor_empty_is_none():
    assert rec._nearest_loved_anchor(zero_vector(), []) is None


# ── _template_reason_v2 ──

def test_template_reason_uses_anchor_and_traits():
    cand = {"genres": ["Drama"], "vote_average": 7.5}
    r = rec._template_reason_v2(cand, "Heat", ["slow-burn", "cerebral"])
    assert "Heat" in r and "slow-burn" in r


def test_template_reason_anchor_only():
    cand = {"genres": ["Drama"], "vote_average": 7.5}
    r = rec._template_reason_v2(cand, "Heat", [])
    assert "Heat" in r


def test_template_reason_falls_back_to_quality():
    cand = {"genres": ["Drama"], "vote_average": 7.5}
    r = rec._template_reason_v2(cand, None, [])
    assert "7.5" in r


# ── _matched_signal + profile-keyed explanations (QA-EXPL) ──

def _explain_profile():
    gid = next(iter(rec.GENRE_MAP))  # any valid genre id
    return {"people_scores": {101: 5}, "loved_genres": {gid: 6}, "top_keywords": ["heist"]}, gid


def test_matched_signal_prefers_director_then_actor_then_theme_then_genre():
    profile, gid = _explain_profile()
    director = {"directors": [[101, "Jane Doe"]], "top_cast": [[101, "Jane Doe"]],
                "keywords": ["heist"], "genre_ids": [gid]}
    assert rec._matched_signal(director, profile) == ("director", "Jane Doe")

    actor = {"directors": [], "top_cast": [[101, "Jane Doe"]], "keywords": ["heist"], "genre_ids": [gid]}
    assert rec._matched_signal(actor, profile) == ("actor", "Jane Doe")

    theme = {"directors": [], "top_cast": [], "keywords": ["heist"], "genre_ids": [gid]}
    assert rec._matched_signal(theme, profile) == ("theme", "heist")

    genre = {"directors": [], "top_cast": [], "keywords": [], "genre_ids": [gid]}
    assert rec._matched_signal(genre, profile)[0] == "genre"

    nothing = {"directors": [], "top_cast": [], "keywords": [], "genre_ids": [-999]}
    assert rec._matched_signal(nothing, profile) == (None, None)


def test_template_reason_keys_on_matched_signal_when_profile_given():
    profile, gid = _explain_profile()
    cand = {"tmdb_id": 1, "directors": [[101, "Jane Doe"]], "top_cast": [], "keywords": [],
            "themes": [], "genre_ids": [gid], "vote_average": 8.0}
    r = rec._template_reason_v2(cand, "Heat", ["slow-burn"], profile)
    assert "Jane Doe" in r  # the concrete director match, not the generic DNA line


# ── _ensure_recency (QA-FRESH) ──

def test_ensure_recency_swaps_in_a_recent_pick_when_none_present():
    import datetime
    cy = datetime.datetime.utcnow().year
    picks = [{"tmdb_id": i, "year": 1990, "score": 1.0 - i * 0.1} for i in range(3)]
    recent = {"tmdb_id": 99, "year": cy, "score": 0.4}
    rec._ensure_recency(picks, picks + [recent])
    assert any(p["tmdb_id"] == 99 for p in picks)


def test_ensure_recency_is_noop_when_a_recent_pick_exists():
    import datetime
    cy = datetime.datetime.utcnow().year
    picks = [{"tmdb_id": 1, "year": cy, "score": 0.9}, {"tmdb_id": 2, "year": 1990, "score": 0.8}]
    before = [p["tmdb_id"] for p in picks]
    rec._ensure_recency(picks, picks + [{"tmdb_id": 3, "year": cy, "score": 0.95}])
    assert [p["tmdb_id"] for p in picks] == before


# ── _diversify_anchors (QA-ANCHOR) ──

def test_diversify_anchors_spreads_across_loved_films():
    v = {**zero_vector(), "pace": 0.5}
    loved = [("A", dict(v)), ("B", dict(v))]            # equidistant from the picks
    picks = [{"tmdb_id": 1, "dna": dict(v)}, {"tmdb_id": 2, "dna": dict(v)}]
    rec._diversify_anchors(picks, loved)
    assert {p["anchor"] for p in picks} == {"A", "B"}  # not the same one twice

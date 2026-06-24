"""Unit tests for backend/group.py — the group 'Movie Night' blend (UX19). Pure, no network."""
from backend.group import guest_profile, blend_scores, fit_label

# genre ids → names (subset for the test)
GENRES = {28: "Action", 35: "Comedy", 18: "Drama", 27: "Horror"}


def test_guest_profile_builds_genre_affinity():
    ratings = [
        {"tmdb_id": 1, "genre_ids": [28], "rating": 5},   # loves action
        {"tmdb_id": 2, "genre_ids": [27], "rating": 1},   # hates horror
    ]
    profile, dna, conf = guest_profile(ratings, GENRES)
    assert profile["loved_genres"].get(28, 0) > 0
    assert profile["disliked_genres"].get(27, 0) > 0
    # guests carry no people/theme signal in v1
    assert profile["people_scores"] == {} and profile["top_keywords"] == []
    # a non-neutral rating should move the DNA vector off zero
    assert any(abs(v) > 0 for v in dna.values())


def test_blend_is_least_misery_not_naive_average():
    # Polarizing pick: one member loves it, the other hates it.
    polarizing = [1.0, 0.0]
    # Consensus pick: both members merely like it.
    consensus = [0.45, 0.45]
    # Naive average would (barely) prefer the polarizing pick…
    assert sum(polarizing) / 2 > sum(consensus) / 2
    # …but the least-misery blend prefers the one nobody dislikes.
    assert blend_scores(consensus) > blend_scores(polarizing)


def test_blend_empty_is_zero():
    assert blend_scores([]) == 0.0


def test_fit_label_buckets_by_relative_position():
    spread = [0.1, 0.5, 0.9]
    assert fit_label(0.9, spread) == "loves it"
    assert fit_label(0.5, spread) == "likes it"
    assert fit_label(0.1, spread) == "it's ok"


def test_fit_label_handles_flat_spread():
    # identical scores → no crash, neutral label
    assert fit_label(0.5, [0.5, 0.5, 0.5]) == "likes it"

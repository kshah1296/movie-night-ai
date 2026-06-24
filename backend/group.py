"""Group "Movie Night" blend (UX19) — pure, testable, no network.

Turns each guest's in-session ratings into a lightweight taste profile (genre affinity + proxy DNA),
and blends per-member candidate scores with a **least-misery + average** objective so the group's pick
is one nobody hates — not a bland average that pleases no one.
"""
from collections import Counter
from typing import Dict, List, Tuple

from backend.dna import proxy_dna, aggregate_profile_dna

GROUP_MEAN_WEIGHT = 0.4  # after least-misery (min), the mean breaks ties toward broadly-loved picks


def guest_profile(ratings: List[dict], genre_names: Dict[int, str],
                  facets_by_id: Dict[int, dict] = None):
    """ratings: [{tmdb_id, genre_ids:[int], rating:1..5}], genre_names: {id: name}.
    Returns (profile, user_dna, confidence) shaped for `scoring.score_candidate`. Genre affinity +
    proxy DNA always; when `facets_by_id` carries cached facets for a guest's rated movies, the
    guest is **upgraded to full fidelity** with people + theme affinity too (QA-GUESTFI)."""
    facets_by_id = facets_by_id or {}
    loved: Counter = Counter()
    disliked: Counter = Counter()
    people: Counter = Counter()
    keywords: Counter = Counter()
    contributions: List[Tuple[float, Dict[str, float]]] = []
    for r in ratings:
        w = float(r.get("rating", 0)) - 3.0
        gids = r.get("genre_ids", []) or []
        for g in gids:
            if w > 0:
                loved[g] += w
            elif w < 0:
                disliked[g] += -w
        names = [genre_names[g] for g in gids if g in genre_names]
        f = facets_by_id.get(int(r.get("tmdb_id", -1))) or {}
        contributions.append((w, proxy_dna(f or None, names)))   # facets sharpen the proxy DNA too
        if w > 0 and f:
            for pid, _n in (f.get("directors") or []):
                people[pid] += w * 1.5
            for pid, _n in (f.get("top_cast") or [])[:5]:
                people[pid] += w
            for kw in (f.get("keywords") or []):
                keywords[kw.lower()] += w
    user_dna, confidence = aggregate_profile_dna(contributions)
    profile = {
        "loved_genres": dict(loved),
        "disliked_genres": dict(disliked),
        "people_scores": dict(people),
        "top_keywords": [k for k, _ in keywords.most_common(12)],
        "avoid_keywords": [],
    }
    return profile, user_dna, confidence


def blend_scores(member_scores: List[float], mean_weight: float = GROUP_MEAN_WEIGHT) -> float:
    """Least-misery + average. The min term means one person's veto outweighs another's
    enthusiasm; the mean term breaks ties toward picks the whole group leans into."""
    if not member_scores:
        return 0.0
    return min(member_scores) + mean_weight * (sum(member_scores) / len(member_scores))


def fit_label(score: float, all_scores: List[float]) -> str:
    """A per-member qualitative fit for one pick, relative to that member's own score spread
    across the served set (so it reads 'loves it / likes it / it's ok' per person)."""
    if not all_scores:
        return "likes it"
    lo, hi = min(all_scores), max(all_scores)
    if hi - lo < 1e-9:
        return "likes it"
    pct = (score - lo) / (hi - lo)
    if pct >= 0.66:
        return "loves it"
    if pct >= 0.33:
        return "likes it"
    return "it's ok"

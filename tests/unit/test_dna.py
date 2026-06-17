"""Unit tests for backend/dna.py — the Taste-DNA primitives."""
import math

from backend import dna


# ── proxy_dna ──

def test_zero_vector_has_all_axes():
    z = dna.zero_vector()
    assert set(z) == set(dna.AXES)
    assert all(v == 0.0 for v in z.values())


def test_proxy_dna_action_is_fast_and_action_driven():
    v = dna.proxy_dna({"keywords": [], "runtime": 120}, ["Action"])
    assert v["pace"] > 0       # action leans fast
    assert v["texture"] < 0    # action-driven (negative pole)
    assert all(-1.0 <= x <= 1.0 for x in v.values())


def test_proxy_dna_clamps_to_unit_range():
    v = dna.proxy_dna({"keywords": ["slow burn", "bleak", "gore"], "runtime": 200},
                      ["Drama", "Horror", "War"])
    assert all(-1.0 <= x <= 1.0 for x in v.values())


def test_proxy_dna_keyword_nudges_pace():
    slow = dna.proxy_dna({"keywords": ["slow burn"]}, ["Drama"])
    fast = dna.proxy_dna({"keywords": ["fast paced"]}, ["Drama"])
    assert slow["pace"] < fast["pace"]


def test_proxy_dna_foreign_language_leans_indie():
    en = dna.proxy_dna({"original_language": "en"}, ["Drama"])
    fr = dna.proxy_dna({"original_language": "fr"}, ["Drama"])
    assert fr["scale"] > en["scale"]


def test_proxy_dna_blockbuster_vs_underseen_scale():
    blockbuster = dna.proxy_dna({}, ["Action"], vote_count=50000)
    underseen = dna.proxy_dna({}, ["Action"], vote_count=120)
    assert blockbuster["scale"] < underseen["scale"]


def test_proxy_dna_handles_missing_facets():
    v = dna.proxy_dna(None, ["Comedy"])
    assert v["humor"] > 0


# ── aggregate_profile_dna ──

def test_aggregate_weights_toward_loved():
    slow = {**dna.zero_vector(), "pace": -0.8}
    fast = {**dna.zero_vector(), "pace": 0.8}
    # love the slow film (+2), dislike the fast one (-2) → both push toward slow
    user, conf = dna.aggregate_profile_dna([(2, slow), (-2, fast)])
    assert user["pace"] < 0
    assert conf["pace"] > 0.5      # strong agreement


def test_aggregate_empty_returns_zero():
    user, conf = dna.aggregate_profile_dna([])
    assert all(v == 0.0 for v in user.values())
    assert all(v == 0.0 for v in conf.values())


def test_aggregate_ignores_zero_weight():
    a = {**dna.zero_vector(), "tone": 1.0}
    user, _conf = dna.aggregate_profile_dna([(0, a)])
    assert user["tone"] == 0.0


def test_aggregate_low_agreement_lowers_confidence():
    up = {**dna.zero_vector(), "tone": 0.9}
    down = {**dna.zero_vector(), "tone": -0.9}
    # two equally-loved films that disagree on tone → near-zero confidence
    _user, conf = dna.aggregate_profile_dna([(2, up), (2, down)])
    assert conf["tone"] < 0.2


# ── dna_distance ──

def test_dna_distance_identity_is_zero():
    z = dna.zero_vector()
    assert dna.dna_distance(z, z) == 0.0


def test_dna_distance_opposite_is_one():
    a = {ax: 1.0 for ax in dna.AXES}
    b = {ax: -1.0 for ax in dna.AXES}
    assert math.isclose(dna.dna_distance(a, b), 1.0)


def test_dna_distance_is_bounded():
    a = {**dna.zero_vector(), "pace": 0.5, "tone": -0.3}
    b = {**dna.zero_vector(), "pace": -0.2, "humor": 0.9}
    assert 0.0 <= dna.dna_distance(a, b) <= 1.0


def test_dna_distance_respects_confidence_weights():
    a = {**dna.zero_vector(), "pace": 1.0, "humor": 1.0}
    b = {**dna.zero_vector(), "pace": -1.0, "humor": 1.0}  # differ only on pace
    w_pace = {**{ax: 0.0 for ax in dna.AXES}, "pace": 1.0}
    w_humor = {**{ax: 0.0 for ax in dna.AXES}, "humor": 1.0}
    assert dna.dna_distance(a, b, w_pace) > dna.dna_distance(a, b, w_humor)


# ── axes_to_words ──

def test_axes_to_words_picks_high_confidence_traits():
    user = {**dna.zero_vector(), "pace": -0.8, "complexity": 0.7}
    conf = {**dna.zero_vector(), "pace": 0.9, "complexity": 0.8}
    words = dna.axes_to_words(user, conf)
    assert "slow-burn" in words
    assert "complex" in words


def test_axes_to_words_skips_low_confidence():
    user = {**dna.zero_vector(), "pace": -0.9}
    conf = {**dna.zero_vector(), "pace": 0.05}  # below the confidence floor
    assert dna.axes_to_words(user, conf) == []


def test_axes_to_words_respects_limit():
    user = {ax: 0.9 for ax in dna.AXES}
    conf = {ax: 0.9 for ax in dna.AXES}
    assert len(dna.axes_to_words(user, conf, limit=3)) == 3


# ── llm_score_dna (parsing path, Groq client mocked) ──

def test_llm_score_dna_parses_clamps_and_fills(monkeypatch):
    payload = '{"axes": {"pace": 2.5, "focus": 0.4}, "themes": ["grief", "Loss"]}'

    class _Msg:
        content = payload

    class _Resp:
        choices = [type("C", (), {"message": _Msg()})()]

    class _FakeGroq:
        def __init__(self, **_kw):
            self.chat = type("Chat", (), {
                "completions": type("Comp", (), {"create": lambda self, **kw: _Resp()})()
            })()

    monkeypatch.setattr(dna, "Groq", _FakeGroq)
    out = dna.llm_score_dna({"title": "X", "genres": [], "keywords": [], "overview": ""}, "key")
    assert out["axes"]["pace"] == 1.0           # 2.5 clamped to 1.0
    assert out["axes"]["focus"] == 0.4
    assert set(out["axes"]) == set(dna.AXES)    # missing axes default to 0.0
    assert out["themes"] == ["grief", "loss"]   # lowercased


def test_llm_score_dna_returns_none_on_garbage(monkeypatch):
    class _Msg:
        content = "sorry, no JSON here"

    class _Resp:
        choices = [type("C", (), {"message": _Msg()})()]

    class _FakeGroq:
        def __init__(self, **_kw):
            self.chat = type("Chat", (), {
                "completions": type("Comp", (), {"create": lambda self, **kw: _Resp()})()
            })()

    monkeypatch.setattr(dna, "Groq", _FakeGroq)
    assert dna.llm_score_dna({"title": "X"}, "key") is None

"use client";

import { useEffect, useState } from "react";
import {
  getTrendingMovies, getGroupRecommendations,
  type TmdbMovie, type GroupMember, type GroupResponse,
} from "@/lib/api";
import Poster from "@/components/Poster";
import StarRating from "@/components/StarRating";
import MovieModal from "@/components/MovieModal";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { useToast } from "@/components/ToastProvider";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const STORE_KEY = "mn-group-guests";
const MIN_RATINGS = 3; // a guest needs at least this many to have any taste signal

const FIT_COLOR: Record<string, string> = {
  "loves it": "#34d399",
  "likes it": "var(--accent)",
  "it's ok": "var(--text-3)",
};

function loadGuests(): GroupMember[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch { return []; }
}
function saveGuests(g: GroupMember[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(g)); } catch { /* ignore */ }
}

export default function GroupPage() {
  useDocumentTitle("Movie Night");
  const push = useToast();
  const [guests, setGuests] = useState<GroupMember[]>([]);
  const [trending, setTrending] = useState<TmdbMovie[]>([]);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftRatings, setDraftRatings] = useState<Record<number, { rating: number; genre_ids: number[] }>>({});
  const [result, setResult] = useState<GroupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalId, setModalId] = useState<number | null>(null);

  useEffect(() => {
    // localStorage is client-only → read after mount (hydration-safe).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGuests(loadGuests());
    getTrendingMovies(1).then((r) => setTrending(r.results.slice(0, 18))).catch(() => {});
  }, []);

  function rateDraft(m: TmdbMovie, rating: number) {
    setDraftRatings((prev) => {
      const next = { ...prev };
      if (rating === 0) delete next[m.id];
      else next[m.id] = { rating, genre_ids: m.genre_ids };
      return next;
    });
  }

  function saveGuest() {
    const ratings = Object.entries(draftRatings).map(([id, v]) => ({
      tmdb_id: Number(id), genre_ids: v.genre_ids, rating: v.rating,
    }));
    const member: GroupMember = { name: draftName.trim() || "Guest", ratings };
    const next = [...guests.filter((g) => g.name !== member.name), member];
    setGuests(next);
    saveGuests(next);
    setAdding(false);
    setDraftName("");
    setDraftRatings({});
    push(`Added ${member.name} (${ratings.length} ratings)`);
  }

  function removeGuest(name: string) {
    const next = guests.filter((g) => g.name !== name);
    setGuests(next);
    saveGuests(next);
    setResult(null);
  }

  async function findMovie() {
    setLoading(true);
    setResult(null);
    try {
      const res = await getGroupRecommendations(guests);
      setResult(res);
      if (!res.recommendations.length) push(res.message || "No common picks found.");
    } catch {
      push("Couldn't build group picks — is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  const draftCount = Object.keys(draftRatings).length;
  const canSave = draftCount >= MIN_RATINGS;
  const canFind = guests.length >= 1 && guests.some((g) => g.ratings.length >= MIN_RATINGS);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem 4rem" }}>
      {modalId && (
        <MovieModal tmdbId={modalId} onClose={() => setModalId(null)} />
      )}

      <PageHeader
        title="Movie Night"
        badge="🍿 Group"
        subtitle="Add the people watching tonight, each rates a few films, and we find one movie you'll all enjoy."
      />

      {/* Participants */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", marginBottom: "1.5rem" }}>
        <span className="chip" style={{ cursor: "default", borderColor: "var(--accent)", color: "var(--text-1)" }}>
          🧬 You (your ratings)
        </span>
        {guests.map((g) => (
          <span key={g.name} className="chip" style={{ cursor: "default", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            {g.name} · {g.ratings.length}★
            <button onClick={() => removeGuest(g.name)} aria-label={`Remove ${g.name}`}
              style={{ background: "none", border: "none", color: "var(--text-3)", cursor: "pointer", fontSize: "0.9rem", padding: 0 }}>
              ✕
            </button>
          </span>
        ))}
        {!adding && (
          <button className="btn-secondary btn-sm" onClick={() => setAdding(true)}>+ Add person</button>
        )}
      </div>

      {/* Add-person quick-rate panel */}
      {adding && (
        <div className="gradient-border" style={{ padding: "1.25rem", borderRadius: "var(--radius-lg)", marginBottom: "2rem" }}>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Their name"
              aria-label="Guest name"
              style={{
                flex: "1 1 180px", padding: "0.6rem 0.9rem", borderRadius: "var(--radius-sm)",
                background: "var(--surface)", border: "1px solid var(--border-strong)", color: "var(--text-1)",
              }}
            />
            <span style={{ color: canSave ? "var(--text-2)" : "var(--gold)", fontSize: "0.8rem" }}>
              {draftCount}/{MIN_RATINGS} rated{canSave ? " ✓" : " (rate a few they've seen)"}
            </span>
            <button className="btn-primary btn-sm" disabled={!canSave} onClick={saveGuest}>Save person</button>
            <button className="btn-secondary btn-sm" onClick={() => { setAdding(false); setDraftName(""); setDraftRatings({}); }}>Cancel</button>
          </div>
          <p style={{ color: "var(--text-3)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
            Tap the stars on movies they&apos;ve seen — a few is enough.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "var(--space-4)" }}>
            {trending.map((m) => (
              <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <Poster path={m.poster_path} alt={m.title} />
                <p style={{ fontSize: "0.78rem", fontWeight: 600, lineHeight: 1.25,
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {m.title}
                </p>
                <StarRating value={draftRatings[m.id]?.rating ?? 0} onChange={(r) => rateDraft(m, r)} size="sm" label={`Rate ${m.title}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Find button */}
      <div style={{ marginBottom: "2rem" }}>
        <button className="btn-primary" disabled={!canFind || loading} onClick={findMovie}
          style={{ fontSize: "1rem", padding: "0.75rem 2rem" }}>
          {loading ? "Finding…" : "🍿 Find our movie"}
        </button>
        {!canFind && (
          <p style={{ color: "var(--text-3)", fontSize: "0.8rem", marginTop: "0.6rem" }}>
            Add at least one person who&apos;s rated {MIN_RATINGS}+ movies.
          </p>
        )}
      </div>

      {/* Results */}
      {result && result.recommendations.length > 0 && (
        <div className="content-fade-in">
          <h2 style={{ fontSize: "var(--font-xl)", fontWeight: 700, marginBottom: "1rem" }}>
            Picks for {result.members.join(", ")}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: "var(--space-5)" }}>
            {result.recommendations.map((rec, i) => (
              <div key={rec.tmdb_id} className="gradient-border card-in" onClick={() => setModalId(rec.tmdb_id)}
                style={{ overflow: "hidden", cursor: "pointer", animationDelay: `${Math.min(i * 40, 400)}ms` }}>
                <div style={{ display: "flex", gap: "var(--space-4)", padding: "var(--space-4)" }}>
                  <Poster path={rec.poster_path} alt={rec.title} voteAverage={rec.vote_average} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {rec.bucket && (
                      <span style={{ fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase",
                        letterSpacing: "0.04em", color: "var(--accent)" }}>{rec.bucket}</span>
                    )}
                    <h3 style={{ fontWeight: 700, fontSize: "0.95rem", margin: "0.15rem 0", lineHeight: 1.3 }}>{rec.title}</h3>
                    <p style={{ color: "var(--text-2)", fontSize: "var(--font-xs)", marginBottom: "0.4rem" }}>
                      {rec.year ?? "—"} · {rec.genres.slice(0, 2).join(", ")}
                    </p>
                    <p style={{ color: "var(--text-bright)", fontSize: "var(--font-sm)", lineHeight: 1.5, marginBottom: "0.6rem" }}>
                      {rec.explanation}
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      {rec.member_fit.map((f) => (
                        <span key={f.name} style={{
                          fontSize: "0.7rem", fontWeight: 600, padding: "0.12rem 0.5rem", borderRadius: 999,
                          border: `1px solid ${FIT_COLOR[f.fit] ?? "var(--border-strong)"}`,
                          color: FIT_COLOR[f.fit] ?? "var(--text-2)",
                        }}>
                          {f.name}: {f.fit}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && result.recommendations.length === 0 && (
        <EmptyState emoji="🤝" title="No movie everyone agrees on yet"
          subtitle={result.message || "Try having someone rate a few more films, or remove a very picky guest."} />
      )}

      {!result && !adding && guests.length === 0 && (
        <EmptyState emoji="🍿" title="Who's watching tonight?"
          subtitle="Add the people on the couch — each rates a handful of movies they've seen, and we'll find one everyone will enjoy.">
          <button className="btn-primary" onClick={() => setAdding(true)}>+ Add the first person</button>
        </EmptyState>
      )}
    </div>
  );
}

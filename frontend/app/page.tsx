"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  getRecommendations, rateAndAddWatched, addToWatchlist, deleteRating,
  sendRecFeedback, getRatings, getWatchlist, logEvent,
  type Recommendation, type TasteInfo,
} from "@/lib/api";
import MovieCard from "@/components/MovieCard";
import MovieModal from "@/components/MovieModal";
import { useToast } from "@/components/ToastProvider";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { SkeletonGrid } from "@/components/SkeletonCard";
import {
  STREAMING_PROVIDERS, loadServices, saveServices, loadStreamingOnly, saveStreamingOnly,
} from "@/lib/streaming";
import { useCardRatings } from "@/lib/ratings";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { gridArrowNav } from "@/lib/gridNav";

const MOODS = [
  { id: "cozy", emoji: "🛋️", label: "Cozy" },
  { id: "mind-bender", emoji: "🌀", label: "Mind-bender" },
  { id: "date-night", emoji: "💜", label: "Date night" },
  { id: "adrenaline", emoji: "⚡", label: "Adrenaline" },
];

// Fixed list — NOT derived from the current recs, so any genre is always reachable
const GENRES = [
  "Action", "Comedy", "Thriller", "Science Fiction", "Horror", "Drama",
  "Crime", "Mystery", "Romance", "Animation", "Fantasy", "Adventure",
];

const UNDO_WINDOW = 5000; // persist "not interested" only after this window (so Undo can't race)

interface ToastAction { label: string; fn: () => void }

export default function HomePage() {
  useDocumentTitle("For You");
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [taste, setTaste] = useState<TasteInfo | null>(null);
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const [coldStart, setColdStart] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [watchlisted, setWatchlisted] = useState<Record<number, boolean>>({});
  const [hasAnyRatings, setHasAnyRatings] = useState<boolean | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [streamingOnly, setStreamingOnly] = useState(false);
  const [services, setServices] = useState<number[]>([]);
  const push = useToast();
  const [modalId, setModalId] = useState<number | null>(null);

  // tmdb_id -> timer that will persist the dismissal once the undo window passes
  const pendingDismiss = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const fetchRecs = useCallback((refresh = 0, genre?: string | null, mood?: string | null, providers?: number[]) => {
    if (refresh > 0) setRefreshing(true);
    else setLoading(true);
    setError("");
    getRecommendations(refresh, genre ?? undefined, mood ?? undefined, providers)
      .then((data) => {
        setRecs(data.recommendations);
        setSource(data.source ?? "");
        setMessage(data.message ?? "");
        setColdStart(data.cold_start ?? false);
        if (data.taste) setTaste(data.taste);
      })
      .catch(() => setError("Could not load recommendations. Is the backend running?"))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => {
    const svcs = loadServices();
    const on = loadStreamingOnly();
    setServices(svcs);
    setStreamingOnly(on);
    fetchRecs(0, null, null, on && svcs.length ? svcs : undefined);

    // Seed rating/watchlist state from the server so card badges are correct even
    // on cache hits and after cross-page edits (P2-7, P2-8).
    Promise.all([getRatings(), getWatchlist()])
      .then(([rs, wl]) => {
        const rmap: Record<number, number> = {};
        rs.forEach((r) => { rmap[r.tmdb_id] = r.rating; });
        const wmap: Record<number, boolean> = {};
        wl.forEach((w) => { wmap[w.tmdb_id] = true; });
        setRatings(rmap);
        setWatchlisted(wmap);
        setHasAnyRatings(rs.length > 0);
      })
      .catch(() => setHasAnyRatings(null));
  }, [fetchRecs]);

  // Flush any pending dismissals if the user navigates away mid-window.
  useEffect(() => {
    const map = pendingDismiss.current;
    return () => {
      map.forEach((timer, id) => {
        clearTimeout(timer);
        const rec = recs.find((r) => r.tmdb_id === id);
        sendRecFeedback({ tmdb_id: id, title: rec?.title }).catch(() => {});
      });
      map.clear();
    };
  }, [recs]);

  // current streaming filter, or undefined when off / no services picked
  const activeProviders = streamingOnly && services.length ? services : undefined;

  function showToast(msg: string, action?: ToastAction) {
    push(msg, action ? { actionLabel: action.label, onAction: action.fn, duration: UNDO_WINDOW } : undefined);
  }

  function pickGenre(g: string | null) {
    setSelectedGenre(g);
    setSelectedMood(null);
    setRefreshCount(0); // mode switch starts a fresh seed (P2-3)
    fetchRecs(0, g, null, activeProviders);
  }

  function pickMood(m: string | null) {
    setSelectedMood(m);
    setSelectedGenre(null);
    setRefreshCount(0);
    fetchRecs(0, null, m, activeProviders);
  }

  function clearAllModes() {
    setSelectedGenre(null);
    setSelectedMood(null);
    setStreamingOnly(false);
    saveStreamingOnly(false);
    setRefreshCount(0);
    fetchRecs(0, null, null, undefined);
  }

  function refresh() {
    const next = refreshCount + 1;
    setRefreshCount(next);
    fetchRecs(next, selectedGenre, selectedMood, activeProviders);
  }

  function toggleStreaming() {
    const on = !streamingOnly;
    setStreamingOnly(on);
    saveStreamingOnly(on);
    setRefreshCount(0);
    fetchRecs(0, selectedGenre, selectedMood, on && services.length ? services : undefined);
  }

  function toggleService(id: number) {
    const next = services.includes(id) ? services.filter((s) => s !== id) : [...services, id];
    setServices(next);
    saveServices(next);
    if (streamingOnly) {
      setRefreshCount(0);
      fetchRecs(0, selectedGenre, selectedMood, next.length ? next : undefined);
    }
  }

  async function handleRate(rec: Recommendation, rating: number) {
    const id = rec.tmdb_id;
    const year = typeof rec.year === "number" ? rec.year : null;
    const prevRating = ratings[id] ?? 0;
    const prevWatchlisted = watchlisted[id] ?? false;

    if (rating === 0) {
      setRatings((prev) => { const n = { ...prev }; delete n[id]; return n; });
      showToast(`Removed rating for "${rec.title}"`);
    } else {
      setRatings((prev) => ({ ...prev, [id]: rating }));
      setWatchlisted((prev) => ({ ...prev, [id]: true }));
      showToast(`Rated "${rec.title}" ${rating}★ · added to Watched`);
    }

    try {
      if (rating === 0) await deleteRating(id);
      else await rateAndAddWatched({ tmdb_id: id, title: rec.title, poster_path: rec.poster_path, genres: rec.genres, year, rating });
    } catch {
      if (prevRating === 0) setRatings((prev) => { const n = { ...prev }; delete n[id]; return n; });
      else setRatings((prev) => ({ ...prev, [id]: prevRating }));
      setWatchlisted((prev) => ({ ...prev, [id]: prevWatchlisted }));
      showToast("Couldn't save — is the backend running?");
    }
  }

  async function handleAddWatchlist(rec: Recommendation) {
    const id = rec.tmdb_id;
    const year = typeof rec.year === "number" ? rec.year : null;
    const prevWatchlisted = watchlisted[id] ?? false;

    setWatchlisted((prev) => ({ ...prev, [id]: true }));
    showToast(`Added "${rec.title}" to watchlist`);
    logEvent(id, "watchlist_add", { bucket: rec.bucket });

    try {
      await addToWatchlist({ tmdb_id: id, title: rec.title, poster_path: rec.poster_path, genres: rec.genres, year });
    } catch {
      setWatchlisted((prev) => ({ ...prev, [id]: prevWatchlisted }));
      showToast("Couldn't save — is the backend running?");
    }
  }

  // Optimistically remove, but only PERSIST after the undo window — so Undo never
  // races the feedback POST (P2-4) and is always reversible within the window.
  function handleNotInterested(rec: Recommendation) {
    const idx = recs.findIndex((r) => r.tmdb_id === rec.tmdb_id);
    logEvent(rec.tmdb_id, "skip", { bucket: rec.bucket });
    setRecs((cur) => cur.filter((r) => r.tmdb_id !== rec.tmdb_id));

    const timer = setTimeout(() => {
      pendingDismiss.current.delete(rec.tmdb_id);
      sendRecFeedback({ tmdb_id: rec.tmdb_id, title: rec.title }).catch(() => {});
    }, UNDO_WINDOW);
    pendingDismiss.current.set(rec.tmdb_id, timer);

    showToast(`Got it — fewer picks like "${rec.title}"`, {
      label: "Undo",
      fn: () => {
        const t = pendingDismiss.current.get(rec.tmdb_id);
        if (t) { clearTimeout(t); pendingDismiss.current.delete(rec.tmdb_id); }
        setRecs((cur) => {
          if (cur.some((r) => r.tmdb_id === rec.tmdb_id)) return cur;
          const copy = [...cur];
          copy.splice(Math.min(idx < 0 ? copy.length : idx, copy.length), 0, rec);
          return copy;
        });
      },
    });
  }

  // Batch-load external scores (IMDb/RT/MC) for the current rec set. Must run before
  // the early returns below so hook order stays stable.
  const cardRatings = useCardRatings(recs.map((r) => r.tmdb_id));

  const moodMeta = MOODS.find((m) => m.id === selectedMood);
  const heading = selectedGenre
    ? `${selectedGenre} night, for you`
    : moodMeta
    ? `${moodMeta.label} picks, for you`
    : "For You";

  if (loading) {
    return (
      <div>
        <PageHeader title={heading} subtitle="Personalized from your ratings" />
        <SkeletonGrid count={8} />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState emoji="📡" title="Couldn't load your picks" subtitle={error}>
        <button className="btn-secondary" onClick={refresh}>↻ Try Again</button>
        <Link href="/search" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
          Browse Movies Instead
        </Link>
      </EmptyState>
    );
  }

  // First-run onboarding: no ratings yet and not inside a mode/filter (P1-1, P1-2)
  const isFirstRun =
    recs.length === 0 && source !== "error" &&
    selectedGenre === null && selectedMood === null && !streamingOnly &&
    hasAnyRatings === false;

  if (isFirstRun) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", paddingTop: "3rem" }}>
        <p style={{ fontSize: "3rem", marginBottom: "0.75rem" }} aria-hidden="true">🍿</p>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>
          <span className="gradient-text">Welcome to Movie Night AI</span>
        </h1>
        <p style={{ color: "var(--text-2)", fontSize: "1rem", marginBottom: "2rem", lineHeight: 1.6 }}>
          Rate a few movies you&apos;ve already seen and the AI builds a personalized list for tonight —
          no more endless scrolling.
        </p>
        <div style={{
          display: "grid", gap: "0.75rem", textAlign: "left",
          maxWidth: 440, margin: "0 auto 2rem",
        }}>
          {[
            { n: "1", t: "Rate movies you've seen", d: "Head to Discover and give a few films a star rating." },
            { n: "2", t: "Get AI picks", d: "Your “For You” list fills with movies matched to your taste." },
            { n: "3", t: "Build your watchlist", d: "Save what looks good and mark things watched as you go." },
          ].map((s) => (
            <div key={s.n} style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "0.75rem", padding: "0.85rem 1rem" }}>
              <span style={{
                flexShrink: 0, width: 28, height: 28, borderRadius: "50%",
                background: "var(--gradient-2)", color: "white", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem",
              }}>{s.n}</span>
              <div>
                <p style={{ fontWeight: 700, fontSize: "0.9rem" }}>{s.t}</p>
                <p style={{ color: "var(--text-2)", fontSize: "0.8rem", lineHeight: 1.5 }}>{s.d}</p>
              </div>
            </div>
          ))}
        </div>
        <Link href="/search?nudge=rate" className="btn-primary" style={{ textDecoration: "none", display: "inline-block", fontSize: "1rem", padding: "0.75rem 2rem" }}>
          Start rating movies →
        </Link>
      </div>
    );
  }

  if (recs.length === 0) {
    const isError = source === "error";
    const hasMode = selectedGenre !== null || selectedMood !== null || streamingOnly;
    return (
      <EmptyState
        emoji={isError ? "😕" : "🎬"}
        title={isError ? "No picks match these filters" : (message || "Rate some movies to get started")}
        subtitle={isError
          ? "Try clearing a filter or two below."
          : "Your AI picks are built from the movies you rate — rate a few more to unlock them."}
      >
        {hasMode && (
          <button className="btn-secondary" onClick={clearAllModes}>Reset all filters</button>
        )}
        {isError && !hasMode && (
          <button className="btn-secondary" onClick={refresh}>↻ Try Again</button>
        )}
        <Link href="/search" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
          Search &amp; Rate Movies
        </Link>
      </EmptyState>
    );
  }

  const isFallback = source === "tmdb";

  return (
    <div>
      {modalId && (
        <MovieModal
          tmdbId={modalId}
          initialRating={ratings[modalId] ?? 0}
          initialWatchlisted={watchlisted[modalId] ?? false}
          onClose={() => setModalId(null)}
          onRated={(id, r) => {
            if (r === 0) setRatings((prev) => { const n = { ...prev }; delete n[id]; return n; });
            else setRatings((prev) => ({ ...prev, [id]: r }));
          }}
          onWatchlisted={(id) => setWatchlisted((prev) => ({ ...prev, [id]: true }))}
        />
      )}

      <PageHeader
        title={heading}
        badge="✨ For You"
        subtitle="Personalized from your ratings"
        actions={
          <button
            className="btn-secondary"
            onClick={refresh}
            disabled={refreshing}
            style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}
          >
            <span className={refreshing ? "spin-icon" : ""} aria-hidden="true">↻</span>
            {refreshing ? "Finding new picks…" : "Refresh Picks"}
          </button>
        }
      />

      {/* Cold-start: be honest that we're still learning, and nudge more ratings (Q5) */}
      {coldStart && message && (
        <p style={{
          color: "var(--text-1)", fontSize: "0.82rem", marginTop: "-0.5rem", marginBottom: "0.85rem",
          background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)",
          padding: "0.5rem 0.75rem",
        }}>
          🌱 {message}
        </p>
      )}

      {/* Honest note when the LLM ranker is unavailable (quota) and we fell back (P2-1) */}
      {isFallback && !coldStart && (
        <p style={{ color: "var(--text-2)", fontSize: "0.78rem", marginTop: "-0.5rem", marginBottom: "0.85rem" }}>
          ✨ AI ranking is resting right now — these are taste-matched by similarity instead.
        </p>
      )}

      {/* "Your taste" strip — read-only summary of what the engine inferred (P1-8) */}
      {taste && ((taste.dna?.length ?? 0) > 0 || taste.keywords.length > 0 || taste.people.length > 0 || taste.genres.length > 0) && (
        <div className="chip-row" style={{ marginBottom: "var(--space-3)" }}>
          <span style={{ color: "var(--text-3)", fontSize: "0.7rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginRight: "0.15rem", flexShrink: 0 }}>
            What we&apos;ve learned
          </span>
          {(taste.dna ?? []).map((t) => (
            <span key={`d-${t}`} className="taste-pill" title="A core trait of your taste — your Taste DNA"
              style={{ borderColor: "var(--accent)", color: "var(--text-1)" }}>
              {t}
            </span>
          ))}
          {taste.genres.map((t) => <span key={`g-${t}`} className="taste-pill" title="Inferred from your ratings">{t}</span>)}
          {taste.people.map((t) => <span key={`p-${t}`} className="taste-pill" title="A name that recurs in films you rated highly">🎬 {t}</span>)}
          {taste.keywords.map((t) => <span key={`k-${t}`} className="taste-pill" title="A theme that recurs in films you rated highly">{t}</span>)}
        </div>
      )}

      {/* Mode bar: mood pills + fixed genre chips, one scrollable line (no chip wall) */}
      <div className="chip-row" style={{ marginBottom: "var(--space-2)" }}>
        {MOODS.map((m) => (
          <button
            key={m.id}
            className={`tab${selectedMood === m.id ? " tab-active" : ""}`}
            aria-pressed={selectedMood === m.id}
            onClick={() => pickMood(selectedMood === m.id ? null : m.id)}
            style={{ flexShrink: 0 }}
          >
            <span aria-hidden="true">{m.emoji}</span> {m.label}
          </button>
        ))}
        <span className="mode-divider" />
        {GENRES.map((g) => (
          <button
            key={g}
            className={`chip${selectedGenre === g ? " chip-active" : ""}`}
            aria-pressed={selectedGenre === g}
            onClick={() => pickGenre(selectedGenre === g ? null : g)}
          >
            {g}
          </button>
        ))}
        {(selectedGenre || selectedMood) && (
          <button onClick={() => pickGenre(null)} className="chip">
            ✕ Clear
          </button>
        )}
      </div>

      {/* Streaming filter: toggle + service chips (persisted in localStorage) */}
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "var(--space-6)", flexWrap: "wrap", alignItems: "center" }}>
        <button
          className={`tab${streamingOnly && services.length ? " tab-active" : ""}`}
          aria-pressed={streamingOnly}
          onClick={toggleStreaming}
          style={streamingOnly && services.length === 0 ? { border: "1px solid var(--gold)", color: "var(--gold)" } : undefined}
        >
          <span aria-hidden="true">📺</span> My services only
        </button>
        {streamingOnly && STREAMING_PROVIDERS.map((p) => (
          <button
            key={p.id}
            className={`chip${services.includes(p.id) ? " chip-active" : ""}`}
            aria-pressed={services.includes(p.id)}
            onClick={() => toggleService(p.id)}
          >
            {p.label}
          </button>
        ))}
        {streamingOnly && services.length === 0 && (
          <span style={{ color: "var(--gold)", fontSize: "0.75rem", fontWeight: 600 }}>
            ← pick your services (filter is off until you do)
          </span>
        )}
      </div>

      <div className="content-fade-in" onKeyDown={gridArrowNav} style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))",
        gap: "var(--space-5)",
        opacity: refreshing ? 0.45 : 1,
        transition: "opacity 0.2s",
        pointerEvents: refreshing ? "none" : "auto",
      }}>
        {recs.map((rec, i) => (
          <MovieCard
            key={rec.tmdb_id}
            movie={{
              id: rec.tmdb_id,
              title: rec.title,
              poster_path: rec.poster_path,
              vote_average: rec.vote_average,
              metaLine: `${rec.year ?? "—"} · ${rec.genres.slice(0, 2).join(", ")}`,
              body: rec.explanation,
              bodyEmphasis: true,
              kicker: rec.anchor ? `Inspired by ${rec.anchor}` : undefined,
              bucket: rec.bucket,
              bucketReason: rec.bucket_reason,
            }}
            index={i}
            rating={ratings[rec.tmdb_id] ?? 0}
            inWatchlist={watchlisted[rec.tmdb_id] ?? false}
            isWatched={false}
            ratings={cardRatings[rec.tmdb_id]}
            onOpen={() => { logEvent(rec.tmdb_id, "click", { bucket: rec.bucket, position: i }); setModalId(rec.tmdb_id); }}
            onRate={(r) => handleRate(rec, r)}
            onWatchlist={() => handleAddWatchlist(rec)}
            onDismiss={() => handleNotInterested(rec)}
          />
        ))}
      </div>

      {/* UX11 — when the engine returns fewer than its target (pool thinning because you've
          rated/dismissed most matches), be honest and point to the next step. */}
      {!coldStart && !refreshing && selectedGenre === null && selectedMood === null
        && !streamingOnly && recs.length > 0 && recs.length < 12 && (
        <div style={{
          marginTop: "var(--space-6)", textAlign: "center", padding: "1.25rem 1rem",
          color: "var(--text-2)", fontSize: "0.85rem", lineHeight: 1.6,
        }}>
          🎬 You&apos;ve seen most of your best matches. Rate a few more films (or watch something on your
          watchlist) and check back — fresh picks come in as your taste grows.
          <div style={{ marginTop: "0.75rem" }}>
            <Link href="/search" className="btn-secondary btn-sm" style={{ textDecoration: "none" }}>
              Rate more movies
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  getWatchlist,
  addToWatchlist,
  updateWatchlistItem,
  removeFromWatchlist,
  type WatchlistItem,
} from "@/lib/api";
import StarRating from "@/components/StarRating";
import Poster from "@/components/Poster";
import RatingBadges from "@/components/RatingBadges";
import { useCardRatings } from "@/lib/ratings";
import { useWatchMeta } from "@/lib/watchlistMeta";
import { STREAMING_PROVIDERS, loadServices, saveServices } from "@/lib/streaming";
import { logEvent } from "@/lib/api";
import Toast from "@/components/Toast";
import { SkeletonGrid } from "@/components/SkeletonCard";
import MovieModal from "@/components/MovieModal";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

type StatusFilter = "unwatched" | "watched";
type SortKey = "added" | "oldest" | "title" | "year" | "runtime" | "rating";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "added", label: "🆕 Recently added" },
  { key: "oldest", label: "⏳ Oldest first" },
  { key: "runtime", label: "⏱️ Shortest first" },
  { key: "rating", label: "⭐ Highest rated" },
  { key: "year", label: "📅 Newest film" },
  { key: "title", label: "🔤 Title A–Z" },
];
const RUNTIMES: { key: string; label: string; lte?: number; gte?: number }[] = [
  { key: "short", label: "< 90m", lte: 90 },
  { key: "mid", label: "90–120m", gte: 90, lte: 120 },
  { key: "long", label: "2h+", gte: 120 },
];
const PROVIDER_LABEL: Record<number, string> = Object.fromEntries(
  STREAMING_PROVIDERS.map((p) => [p.id, p.label]),
);
const SORT_KEY = "movieNightWatchlistSort";

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unwatched");
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [toastId, setToastId] = useState(0);
  const [removed, setRemoved] = useState<{ item: WatchlistItem; index: number } | null>(null);
  const [modalId, setModalId] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("added");
  const [runtimeFilter, setRuntimeFilter] = useState<string | null>(null);
  const [servicesOn, setServicesOn] = useState(false);
  const [services, setServices] = useState<number[]>([]);

  useEffect(() => {
    getWatchlist()
      .then(setItems)
      .catch(() => setError("Could not load watchlist. Is the backend running?"))
      .finally(() => setLoading(false));
    setServices(loadServices());
    const savedSort = typeof window !== "undefined" ? window.localStorage.getItem(SORT_KEY) : null;
    if (savedSort) setSort(savedSort as SortKey);
  }, []);

  function pickSort(s: SortKey) {
    setSort(s);
    if (typeof window !== "undefined") window.localStorage.setItem(SORT_KEY, s);
  }

  function toggleService(id: number) {
    const next = services.includes(id) ? services.filter((s) => s !== id) : [...services, id];
    setServices(next);
    saveServices(next);
  }

  // Plain toast (clears any pending Undo so it can't attach to an unrelated message).
  function showToast(msg: string) {
    setToast(msg);
    setRemoved(null);
    setToastId((n) => n + 1);
  }

  async function toggleWatched(item: WatchlistItem) {
    const optimistic = { ...item, watched: !item.watched };
    setItems((prev) => prev.map((i) => i.tmdb_id === item.tmdb_id ? optimistic : i));
    showToast(item.watched ? `Moved "${item.title}" back to unwatched` : `Marked "${item.title}" as watched`);
    try {
      const updated = await updateWatchlistItem(item.tmdb_id, { watched: !item.watched });
      setItems((prev) => prev.map((i) => i.tmdb_id === item.tmdb_id ? updated : i));
    } catch {
      setItems((prev) => prev.map((i) => i.tmdb_id === item.tmdb_id ? item : i));
      showToast("Couldn't update — is the backend running?");
    }
  }

  async function handlePostRating(item: WatchlistItem, rating: number) {
    const newRating = rating === 0 ? null : rating;
    const optimistic = { ...item, post_watch_rating: newRating };
    setItems((prev) => prev.map((i) => i.tmdb_id === item.tmdb_id ? optimistic : i));
    showToast(rating === 0 ? `Cleared rating for "${item.title}"` : `Rated "${item.title}" ${rating}★`);
    try {
      const updated = await updateWatchlistItem(item.tmdb_id, { post_watch_rating: newRating });
      setItems((prev) => prev.map((i) => i.tmdb_id === item.tmdb_id ? updated : i));
    } catch {
      setItems((prev) => prev.map((i) => i.tmdb_id === item.tmdb_id ? item : i));
      showToast("Couldn't save rating — is the backend running?");
    }
  }

  async function handleRemove(item: WatchlistItem) {
    const index = items.findIndex((i) => i.tmdb_id === item.tmdb_id);
    setItems((prev) => prev.filter((i) => i.tmdb_id !== item.tmdb_id));
    setRemoved({ item, index });          // capture position so Undo restores in place (P2-6)
    setToast(`Removed "${item.title}"`);
    setToastId((n) => n + 1);
    try {
      await removeFromWatchlist(item.tmdb_id);
    } catch {
      setItems((prev) => {
        const copy = [...prev];
        copy.splice(Math.min(index < 0 ? copy.length : index, copy.length), 0, item);
        return copy;
      });
      setRemoved(null);
      showToast("Couldn't remove — is the backend running?");
    }
  }

  async function handleUndo() {
    const snapshot = removed;
    if (!snapshot) return;
    const { item, index } = snapshot;
    setItems((prev) => {
      if (prev.some((i) => i.tmdb_id === item.tmdb_id)) return prev;
      const copy = [...prev];
      copy.splice(Math.min(index < 0 ? copy.length : index, copy.length), 0, item);
      return copy;
    });
    setRemoved(null);
    try {
      await addToWatchlist({
        tmdb_id: item.tmdb_id,
        title: item.title,
        poster_path: item.poster_path,
        genres: item.genres,
        year: item.year,
        watched: item.watched,
        post_watch_rating: item.post_watch_rating ?? undefined,
      });
      if (item.watched) {
        await updateWatchlistItem(item.tmdb_id, { watched: true });
      }
    } catch {
      showToast("Couldn't restore item");
    }
  }

  const statusFiltered = items.filter((i) =>
    statusFilter === "watched" ? i.watched : !i.watched
  );
  const availableGenres = [...new Set(statusFiltered.flatMap((i) => i.genres))].sort();
  const unwatchedCount = items.filter((i) => !i.watched).length;
  const watchedCount = items.filter((i) => i.watched).length;

  // External scores (IMDb/RT/MC) + runtime/streaming providers, batched for the whole list.
  const cardRatings = useCardRatings(items.map((i) => i.tmdb_id));
  const meta = useWatchMeta(items.map((i) => i.tmdb_id));
  const imdbScore = (id: number) => parseFloat(cardRatings[id]?.imdb ?? "") || 0;

  const displayed = useMemo(() => {
    const rt = RUNTIMES.find((r) => r.key === runtimeFilter);
    const out = statusFiltered.filter((i) => {
      if (selectedGenre && !i.genres.includes(selectedGenre)) return false;
      if (servicesOn && services.length) {
        const provs = meta[i.tmdb_id]?.providers ?? [];
        if (!provs.some((p) => services.includes(p))) return false;
      }
      if (rt) {
        const run = meta[i.tmdb_id]?.runtime;
        if (run == null) return false;          // unknown runtime is excluded when filtering by it
        if (rt.gte != null && run < rt.gte) return false;
        if (rt.lte != null && run > rt.lte) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      switch (sort) {
        case "oldest": return (a.added_at ?? "").localeCompare(b.added_at ?? "");
        case "title": return a.title.localeCompare(b.title);
        case "year": return (b.year ?? 0) - (a.year ?? 0);
        case "runtime": return (meta[a.tmdb_id]?.runtime ?? 1e9) - (meta[b.tmdb_id]?.runtime ?? 1e9);
        case "rating": return imdbScore(b.tmdb_id) - imdbScore(a.tmdb_id);
        default: return (b.added_at ?? "").localeCompare(a.added_at ?? "");  // "added"
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFiltered, selectedGenre, servicesOn, services, runtimeFilter, sort, meta, cardRatings]);

  function surprise() {
    if (displayed.length === 0) return;
    const pick = displayed[Math.floor(Math.random() * displayed.length)];
    showToast(`🎲 Tonight: "${pick.title}"`);
    setModalId(pick.tmdb_id);
  }

  return (
    <div>
      <Toast
        message={toast}
        id={toastId}
        onDismiss={() => { setToast(""); setRemoved(null); }}
        duration={removed ? 6000 : 3500}
        actionLabel={removed ? "Undo" : undefined}
        onAction={removed ? handleUndo : undefined}
      />

      {modalId && (
        <MovieModal
          tmdbId={modalId}
          initialRating={items.find((i) => i.tmdb_id === modalId)?.post_watch_rating ?? 0}
          initialWatchlisted={true}
          onClose={() => {
            setModalId(null);
            getWatchlist().then(setItems).catch(() => {});
          }}
          onRated={(id, r) => {
            setItems((prev) => prev.map((i) =>
              i.tmdb_id === id ? { ...i, post_watch_rating: r === 0 ? null : r, watched: r > 0 ? true : i.watched } : i
            ));
          }}
          onWatchlisted={() => {}}
        />
      )}

      <PageHeader
        title="Watchlist"
        subtitle={loading ? "Loading…" : `${unwatchedCount} to watch · ${watchedCount} watched`}
        actions={
          items.length > 0 ? (
            <Link
              href="/share"
              className="btn-secondary"
              onClick={() => logEvent(0, "share")}
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              <span aria-hidden="true">🔗</span> Share list
            </Link>
          ) : undefined
        }
      />

      {loading && <SkeletonGrid count={6} />}

      {!loading && error && (
        <EmptyState emoji="📡" title="Couldn't load your watchlist" subtitle={error} />
      )}

      {!loading && !error && (
        <>
          {/* Status tabs */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
            {(["unwatched", "watched"] as StatusFilter[]).map((f) => {
              const count = f === "unwatched" ? unwatchedCount : watchedCount;
              return (
                <button
                  key={f}
                  onClick={() => { setStatusFilter(f); setSelectedGenre(null); }}
                  className={`tab${statusFilter === f ? " tab-active" : ""}`}
                  aria-pressed={statusFilter === f}
                >
                  {f === "unwatched" ? "Up Next" : "Watched"}{count > 0 ? ` (${count})` : ""}
                </button>
              );
            })}
          </div>

          {/* Find-a-movie-tonight controls: sort + streaming + runtime + surprise */}
          {items.length > 0 && (
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <select
                className="select-dark"
                value={sort}
                onChange={(e) => pickSort(e.target.value as SortKey)}
                aria-label="Sort watchlist"
              >
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <button
                className={`tab${servicesOn ? " tab-active" : ""}`}
                aria-pressed={servicesOn}
                onClick={() => setServicesOn((v) => !v)}
              >
                📺 On my services
              </button>
              {RUNTIMES.map((r) => (
                <button
                  key={r.key}
                  className={`chip${runtimeFilter === r.key ? " chip-active" : ""}`}
                  aria-pressed={runtimeFilter === r.key}
                  onClick={() => setRuntimeFilter(runtimeFilter === r.key ? null : r.key)}
                >
                  {r.label}
                </button>
              ))}
              <button
                className="btn-secondary btn-sm"
                onClick={surprise}
                disabled={displayed.length === 0}
                title="Pick a random movie from this list"
                style={{ marginLeft: "auto" }}
              >
                🎲 Surprise me
              </button>
            </div>
          )}

          {/* Service picker (shared with For You) — shown when the streaming filter is on */}
          {servicesOn && (
            <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "var(--text-3)", fontSize: "0.75rem", marginRight: "0.25rem" }}>Services:</span>
              {STREAMING_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  className={`chip${services.includes(p.id) ? " chip-active" : ""}`}
                  aria-pressed={services.includes(p.id)}
                  onClick={() => toggleService(p.id)}
                >
                  {p.label}
                </button>
              ))}
              {services.length === 0 && (
                <span style={{ color: "var(--gold)", fontSize: "0.72rem", fontWeight: 600 }}>← pick your services</span>
              )}
            </div>
          )}

          {/* Genre filter chips */}
          {availableGenres.length > 0 && (
            <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.25rem", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ color: "var(--text-3)", fontSize: "0.75rem", marginRight: "0.25rem" }}>Genre:</span>
              {availableGenres.map((g) => (
                <button
                  key={g}
                  onClick={() => setSelectedGenre(selectedGenre === g ? null : g)}
                  className={`chip${selectedGenre === g ? " chip-active" : ""}`}
                  aria-pressed={selectedGenre === g}
                >
                  {g}
                </button>
              ))}
              {selectedGenre && (
                <button onClick={() => setSelectedGenre(null)} className="chip">✕ Clear</button>
              )}
            </div>
          )}

          {items.length === 0 && (
            <EmptyState
              emoji="📋"
              title="Your watchlist is empty"
              subtitle="Browse or search for movies and tap “+ Watchlist” to save them for later."
            >
              <Link href="/search" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
                Browse Movies
              </Link>
            </EmptyState>
          )}

          {items.length > 0 && displayed.length === 0 && (
            <p style={{ color: "var(--text-2)", textAlign: "center", paddingTop: "2rem" }}>
              No movies match these filters{servicesOn ? " — try more services or turn the filter off" : ""}.
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: "var(--space-5)" }}>
            {displayed.map((item, i) => {
              return (
                <div
                  key={item.tmdb_id}
                  className="gradient-border card-in"
                  style={{ animationDelay: `${Math.min(i * 40, 400)}ms`, cursor: "pointer" }}
                  onClick={() => setModalId(item.tmdb_id)}
                >
                  <div style={{ display: "flex", gap: "var(--space-4)", padding: "var(--space-4)" }}>
                    <Poster path={item.poster_path} alt={item.title} watched={item.watched} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.15rem", lineHeight: 1.3 }}>
                        {item.title}
                      </h3>
                      <p style={{ color: "var(--text-2)", fontSize: "var(--font-xs)", marginBottom: "0.5rem" }}>
                        {[
                          item.year,
                          item.genres.slice(0, 2).join(", ") || null,
                          meta[item.tmdb_id]?.runtime
                            ? `${Math.floor(meta[item.tmdb_id].runtime! / 60)}h ${meta[item.tmdb_id].runtime! % 60}m`
                            : null,
                        ].filter(Boolean).join(" · ")}
                      </p>
                      <RatingBadges ratings={cardRatings[item.tmdb_id]} style={{ marginBottom: "0.5rem" }} />
                      {(() => {
                        const provs = (meta[item.tmdb_id]?.providers ?? []).filter((p) => PROVIDER_LABEL[p]);
                        return provs.length > 0 ? (
                          <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                            {provs.map((p) => (
                              <span key={p} style={{
                                fontSize: "0.6rem", fontWeight: 600, padding: "0.1rem 0.4rem",
                                borderRadius: "999px", background: "var(--surface-2)", color: "var(--text-2)",
                              }}>
                                📺 {PROVIDER_LABEL[p]}
                              </span>
                            ))}
                          </div>
                        ) : null;
                      })()}

                      {item.watched && (
                        <div style={{ marginBottom: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                          <p style={{ color: "var(--text-2)", fontSize: "0.7rem", marginBottom: "0.25rem" }}>Your rating:</p>
                          <StarRating
                            value={item.post_watch_rating ?? 0}
                            onChange={(r) => handlePostRating(item, r)}
                            size="sm"
                          />
                        </div>
                      )}

                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn-secondary btn-sm"
                          onClick={() => toggleWatched(item)}
                        >
                          {item.watched ? "↩ Unwatch" : "✓ Mark Watched"}
                        </button>
                        <button
                          className="btn-ghost-danger"
                          aria-label={`Remove ${item.title} from watchlist`}
                          onClick={() => handleRemove(item)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

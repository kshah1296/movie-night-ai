"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  getWatchlist,
  addToWatchlist,
  updateWatchlistItem,
  removeFromWatchlist,
  type WatchlistItem,
} from "@/lib/api";
import { posterUrl } from "@/lib/tmdb";
import StarRating from "@/components/StarRating";
import Toast from "@/components/Toast";
import { SkeletonGrid } from "@/components/SkeletonCard";
import MovieModal from "@/components/MovieModal";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

type StatusFilter = "unwatched" | "watched";

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

  useEffect(() => {
    getWatchlist()
      .then(setItems)
      .catch(() => setError("Could not load watchlist. Is the backend running?"))
      .finally(() => setLoading(false));
  }, []);

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
  const filtered = selectedGenre
    ? statusFiltered.filter((i) => i.genres.includes(selectedGenre))
    : statusFiltered;

  const unwatchedCount = items.filter((i) => !i.watched).length;
  const watchedCount = items.filter((i) => i.watched).length;

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
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              <span aria-hidden="true">🔗</span> Share list
            </Link>
          ) : undefined
        }
      />

      {loading && <SkeletonGrid count={6} />}

      {!loading && error && (
        <div style={{ textAlign: "center", paddingTop: "6rem", color: "#f87171" }}>{error}</div>
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

          {items.length > 0 && filtered.length === 0 && (
            <p style={{ color: "var(--text-2)", textAlign: "center", paddingTop: "2rem" }}>
              No {selectedGenre ? `${selectedGenre} ` : ""}movies here.
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: "1.25rem" }}>
            {filtered.map((item, i) => {
              const poster = posterUrl(item.poster_path);
              return (
                <div
                  key={item.tmdb_id}
                  className="gradient-border card-in"
                  style={{ animationDelay: `${Math.min(i * 40, 400)}ms`, cursor: "pointer" }}
                  onClick={() => setModalId(item.tmdb_id)}
                >
                  <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
                    <div
                      className="poster-frame"
                      style={{
                        width: 100, height: 150, borderRadius: "0.5rem", overflow: "hidden",
                        flexShrink: 0, background: "#27272a",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        position: "relative",
                      }}
                    >
                      {poster ? (
                        <Image src={poster} alt={item.title} width={100} height={150}
                          style={{ objectFit: "cover", width: "100%", height: "100%" }} />
                      ) : (
                        <span style={{ fontSize: "2rem" }}>🎬</span>
                      )}
                      {item.watched && (
                        <div
                          role="img"
                          aria-label="Watched"
                          style={{
                            position: "absolute", top: 4, right: 4,
                            width: 24, height: 24,
                            background: "linear-gradient(135deg, #a855f7, #ec4899)",
                            borderRadius: "50%",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "0.7rem", color: "white", fontWeight: 700,
                          }}
                        >
                          <span aria-hidden="true">✓</span>
                        </div>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.15rem", lineHeight: 1.3 }}>
                        {item.title}
                      </h3>
                      <p style={{ color: "#a1a1aa", fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                        {item.year} · {item.genres.slice(0, 2).join(", ")}
                      </p>

                      {item.watched && (
                        <div style={{ marginBottom: "0.5rem" }} onClick={(e) => e.stopPropagation()}>
                          <p style={{ color: "#a1a1aa", fontSize: "0.7rem", marginBottom: "0.25rem" }}>Your rating:</p>
                          <StarRating
                            value={item.post_watch_rating ?? 0}
                            onChange={(r) => handlePostRating(item, r)}
                            size="sm"
                          />
                        </div>
                      )}

                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: "0.72rem", padding: "0.3rem 0.75rem" }}
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

"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getWatchlist, type WatchlistItem } from "@/lib/api";
import { posterUrl } from "@/lib/tmdb";
import PageHeader from "@/components/PageHeader";

export default function SharePage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    getWatchlist()
      .then(setItems)
      .catch(() => setError(true))   // audit L6 — don't leave a silent empty page
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ textAlign: "center", paddingTop: "6rem", color: "var(--text-3)" }}>Loading…</div>;
  }

  if (error) {
    return <div style={{ textAlign: "center", paddingTop: "6rem", color: "var(--danger)" }}>Couldn&apos;t load this list. Please try again later.</div>;
  }

  const watched = items.filter((i) => i.watched);
  const toWatch = items.filter((i) => !i.watched);

  return (
    <div>
      <PageHeader
        align="center"
        title="🎬 Movie Night Watchlist"
        subtitle={`${toWatch.length} to watch · ${watched.length} watched`}
      />

      {toWatch.length > 0 && (
        <section style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontWeight: 700, fontSize: "var(--font-xl)", marginBottom: "1rem", color: "var(--accent)" }}>
            Up Next
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "1rem" }}>
            {toWatch.map((item, i) => (
              <MovieTile key={item.tmdb_id} item={item} index={i} />
            ))}
          </div>
        </section>
      )}

      {watched.length > 0 && (
        <section>
          <h2 style={{ fontWeight: 700, fontSize: "var(--font-xl)", marginBottom: "1rem", color: "var(--text-2)" }}>
            Already Watched
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "1rem" }}>
            {watched.map((item, i) => (
              <MovieTile key={item.tmdb_id} item={item} dimmed index={i} />
            ))}
          </div>
        </section>
      )}

      {items.length === 0 && (
        <p style={{ textAlign: "center", color: "var(--text-3)", paddingTop: "4rem" }}>
          Watchlist is empty.
        </p>
      )}
    </div>
  );
}

function MovieTile({ item, dimmed, index = 0 }: { item: WatchlistItem; dimmed?: boolean; index?: number }) {
  const poster = posterUrl(item.poster_path);
  return (
    <div
      className="card-in"
      style={{
        animationDelay: `${Math.min(index * 40, 400)}ms`,
        background: "var(--surface)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          aspectRatio: "2/3",
          background: "var(--surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          opacity: dimmed ? 0.55 : 1, // dim only the poster, keep text readable (P3-8)
        }}
      >
        {poster ? (
          <Image src={poster} alt={item.title} width={200} height={300} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
        ) : (
          <span style={{ fontSize: "2rem" }}>🎬</span>
        )}
      </div>
      <div style={{ padding: "0.6rem" }}>
        <p style={{
          fontWeight: 600, fontSize: "0.8rem", lineHeight: 1.3,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {item.title}
        </p>
        <p style={{ color: "var(--text-3)", fontSize: "0.7rem" }}>{item.year}</p>
        {item.post_watch_rating ? (
          <p
            style={{ color: "var(--gold)", fontSize: "var(--font-xs)" }}
            aria-label={`Rated ${item.post_watch_rating} out of 5`}
          >
            <span aria-hidden="true">{"★".repeat(Math.max(0, Math.min(5, Math.round(item.post_watch_rating))))}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

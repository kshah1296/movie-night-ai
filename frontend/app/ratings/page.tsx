"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getRatings, upsertRating, deleteRating, type Rating } from "@/lib/api";
import { posterUrl } from "@/lib/tmdb";
import StarRating from "@/components/StarRating";
import Toast from "@/components/Toast";
import { SkeletonGrid } from "@/components/SkeletonCard";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

export default function RatingsPage() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    getRatings()
      .then(setRatings)
      .catch(() => setError("Could not load ratings. Is the backend running?"))
      .finally(() => setLoading(false));
  }, []);

  async function handleRatingChange(r: Rating, newRating: number) {
    const prevRatings = ratings;

    if (newRating === 0) {
      setRatings((prev) => prev.filter((x) => x.tmdb_id !== r.tmdb_id));
      setToast(`Removed rating for "${r.title}"`);
    } else {
      setRatings((prev) => prev.map((x) => x.tmdb_id === r.tmdb_id ? { ...x, rating: newRating } : x));
      setToast(`"${r.title}" rated ${newRating}★`);
    }

    try {
      if (newRating === 0) await deleteRating(r.tmdb_id);
      else await upsertRating({ tmdb_id: r.tmdb_id, title: r.title, poster_path: r.poster_path, genres: r.genres, year: r.year, rating: newRating });
    } catch {
      setRatings(prevRatings);
      setToast("Couldn't save — is the backend running?");
    }
  }

  return (
    <div>
      <Toast message={toast} onDismiss={() => setToast("")} />

      <PageHeader
        title="My Ratings"
        subtitle={loading ? "Loading…" : `${ratings.length} movie${ratings.length !== 1 ? "s" : ""} rated · these power your AI picks`}
      />

      {loading && <SkeletonGrid count={6} />}

      {!loading && error && (
        <EmptyState emoji="📡" title="Couldn't load ratings" subtitle={error} />
      )}

      {!loading && !error && (
        <>
          {ratings.length === 0 && (
            <EmptyState
              emoji="⭐"
              title="No ratings yet"
              subtitle="Rate a few movies you've seen — every rating sharpens your recommendations."
            >
              <Link href="/search" className="btn-primary" style={{ textDecoration: "none", display: "inline-block" }}>
                Search & Rate Movies
              </Link>
            </EmptyState>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: "1.25rem" }}>
            {ratings.map((r, i) => {
              const poster = posterUrl(r.poster_path);
              return (
                <div
                  key={r.tmdb_id}
                  className="gradient-border card-in"
                  style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
                >
                  <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
                    <div
                      className="poster-frame"
                      style={{
                        width: 100, height: 150, borderRadius: "0.5rem", overflow: "hidden",
                        flexShrink: 0, background: "#27272a",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {poster ? (
                        <Image src={poster} alt={r.title} width={100} height={150}
                          style={{ objectFit: "cover", width: "100%", height: "100%" }} />
                      ) : (
                        <span style={{ fontSize: "2rem" }}>🎬</span>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.15rem", lineHeight: 1.3 }}>
                        {r.title}
                      </h3>
                      <p style={{ color: "#a1a1aa", fontSize: "0.75rem", marginBottom: "0.6rem" }}>
                        {r.year} · {r.genres.slice(0, 2).join(", ")}
                      </p>
                      <StarRating value={r.rating} onChange={(n) => handleRatingChange(r, n)} size="sm" />
                      <button
                        className="btn-ghost-danger"
                        style={{ marginTop: "0.5rem" }}
                        aria-label={`Remove rating for ${r.title}`}
                        onClick={() => handleRatingChange(r, 0)}
                      >
                        Remove
                      </button>
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

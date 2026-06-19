"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getRatings, upsertRating, deleteRating, type Rating } from "@/lib/api";
import StarRating from "@/components/StarRating";
import Poster from "@/components/Poster";
import RatingBadges from "@/components/RatingBadges";
import { useCardRatings } from "@/lib/ratings";
import { useToast } from "@/components/ToastProvider";
import { SkeletonGrid } from "@/components/SkeletonCard";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export default function RatingsPage() {
  useDocumentTitle("My Ratings");
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const push = useToast();

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
      push(`Removed rating for "${r.title}"`);
    } else {
      setRatings((prev) => prev.map((x) => x.tmdb_id === r.tmdb_id ? { ...x, rating: newRating } : x));
      push(`"${r.title}" rated ${newRating}★`);
    }

    try {
      if (newRating === 0) await deleteRating(r.tmdb_id);
      else await upsertRating({ tmdb_id: r.tmdb_id, title: r.title, poster_path: r.poster_path, genres: r.genres, year: r.year, rating: newRating });
    } catch {
      setRatings(prevRatings);
      push("Couldn't save — is the backend running?");
    }
  }

  // External scores (IMDb/RT/MC), batched for all rated movies.
  const cardRatings = useCardRatings(ratings.map((r) => r.tmdb_id));

  return (
    <div>
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: "var(--space-5)" }}>
            {ratings.map((r, i) => {
              return (
                <div
                  key={r.tmdb_id}
                  className="gradient-border card-in"
                  style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
                >
                  <div style={{ display: "flex", gap: "var(--space-4)", padding: "var(--space-4)" }}>
                    <Poster path={r.poster_path} alt={r.title} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.15rem", lineHeight: 1.3 }}>
                        {r.title}
                      </h3>
                      <p style={{ color: "var(--text-2)", fontSize: "var(--font-xs)", marginBottom: "0.5rem" }}>
                        {r.year} · {r.genres.slice(0, 2).join(", ")}
                      </p>
                      <RatingBadges ratings={cardRatings[r.tmdb_id]} style={{ marginBottom: "0.5rem" }} />
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

"use client";

import { useState } from "react";
import StarRating from "@/components/StarRating";
import Poster from "@/components/Poster";
import RatingBadges from "@/components/RatingBadges";
import type { MovieRatings } from "@/lib/api";

// Per-bucket accent colors for the small tag (quick visual scanning).
const BUCKET_COLORS: Record<string, string> = {
  "Safe Picks": "#a855f7",
  "Hidden Gems": "#fbbf24",
  "Expand Your Taste": "#38bdf8",
  "Critically Acclaimed": "#34d399",
  "Underseen Favorites": "#f472b6",
  "Wildcard": "#fb923c",
};

export interface MovieCardData {
  id: number;
  title: string;
  poster_path: string | null;
  vote_average: number;
  metaLine: string;       // e.g. "1999 · Sci-Fi, Action"
  body: string;           // overview (search) or AI explanation (For You)
  bodyEmphasis?: boolean; // true = brighter, 3-line body (For You explanation style)
  kicker?: string;        // small gradient-purple line above the title, e.g. "Because you loved Heat"
  bucket?: string;        // recommendation bucket, e.g. "Hidden Gems" — renders a small tag
  bucketReason?: string;  // tooltip explaining the bucket
}

interface MovieCardProps {
  movie: MovieCardData;
  index: number;          // for the .card-in stagger
  rating: number;         // 0 = unrated
  inWatchlist: boolean;
  isWatched: boolean;
  ratings?: MovieRatings; // external critic/audience scores (IMDb/RT/MC)
  onOpen: () => void;
  onRate: (rating: number) => void;
  onWatchlist: () => void;
  onDismiss?: () => void; // renders the "not interested" ✕ when provided
}

export default function MovieCard({
  movie, index, rating, inWatchlist, isWatched, ratings, onOpen, onRate, onWatchlist, onDismiss,
}: MovieCardProps) {
  const [showWhy, setShowWhy] = useState(false);
  // "Why this pick?" only makes sense on For You cards (explanation + bucket reasoning present).
  const canExplain = Boolean(movie.bodyEmphasis && (movie.bucketReason || movie.kicker));
  return (
    <div
      className="gradient-border card-in"
      data-card
      role="button"
      tabIndex={0}
      aria-label={`${movie.title} — open details`}
      style={{ overflow: "hidden", cursor: "pointer", animationDelay: `${Math.min(index * 40, 400)}ms` }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {onDismiss && (
        <button
          className="dismiss-x"
          aria-label={`Not interested in ${movie.title}`}
          title="Not interested"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        >
          ✕
        </button>
      )}
      <div style={{ display: "flex", gap: "var(--space-4)", padding: "var(--space-4)" }}>
        <Poster path={movie.poster_path} alt={movie.title} voteAverage={movie.vote_average} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {movie.bucket && (
            <span
              title={movie.bucketReason}
              style={{
                display: "inline-block", marginBottom: "0.3rem",
                fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.04em",
                textTransform: "uppercase", padding: "0.12rem 0.45rem",
                borderRadius: "999px", whiteSpace: "nowrap",
                color: BUCKET_COLORS[movie.bucket] ?? "var(--text-2)",
                border: `1px solid ${BUCKET_COLORS[movie.bucket] ?? "var(--border-strong)"}`,
                background: "color-mix(in srgb, " + (BUCKET_COLORS[movie.bucket] ?? "var(--text-3)") + " 12%, transparent)",
              }}
            >
              {movie.bucket}
            </span>
          )}
          {movie.kicker && (
            <p style={{
              color: "var(--accent)",
              fontSize: "0.65rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              marginBottom: "0.2rem",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {movie.kicker}
            </p>
          )}
          <h3 style={{
            fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.15rem", lineHeight: 1.3,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {movie.title}
          </h3>
          <p style={{ color: "var(--text-2)", fontSize: "var(--font-xs)", marginBottom: "0.4rem" }}>
            {movie.metaLine}
          </p>
          <RatingBadges ratings={ratings} style={{ marginBottom: "0.4rem" }} />
          <p style={{
            color: movie.bodyEmphasis ? "var(--text-bright)" : "var(--text-2)",
            fontSize: movie.bodyEmphasis ? "var(--font-sm)" : "var(--font-xs)",
            lineHeight: movie.bodyEmphasis ? 1.5 : 1.4,
            marginBottom: canExplain ? "0.3rem" : "var(--space-3)",
            display: "-webkit-box",
            WebkitLineClamp: showWhy ? "unset" : (movie.bodyEmphasis ? 3 : 2),
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {movie.body}
          </p>

          {/* UX3 — expandable "Why this pick?" surfacing the bucket reasoning + anchor inline
              (the bucket reason is otherwise only a desktop hover tooltip). */}
          {canExplain && (
            <div onClick={(e) => e.stopPropagation()} style={{ marginBottom: "var(--space-3)" }}>
              <button
                onClick={() => setShowWhy((v) => !v)}
                aria-expanded={showWhy}
                style={{
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  color: "var(--accent)", fontSize: "0.72rem", fontWeight: 600,
                }}
              >
                {showWhy ? "Hide reasoning ▴" : "Why this pick? ▾"}
              </button>
              {showWhy && (
                <div style={{
                  marginTop: "0.4rem", padding: "0.5rem 0.65rem",
                  background: "var(--surface-2)", borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)", fontSize: "0.72rem",
                  color: "var(--text-2)", lineHeight: 1.5,
                }}>
                  {movie.bucket && (
                    <div style={{ marginBottom: movie.bucketReason || movie.kicker ? "0.3rem" : 0 }}>
                      <strong style={{ color: "var(--text-1)" }}>{movie.bucket}</strong>
                      {movie.bucketReason ? ` — ${movie.bucketReason}` : ""}
                    </div>
                  )}
                  {movie.kicker && (
                    <div style={{ color: "var(--text-3)" }}>🎯 {movie.kicker}</div>
                  )}
                </div>
              )}
            </div>
          )}

          <div onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
              <span style={{ color: "var(--text-3)", fontSize: "0.7rem", fontWeight: 600 }}>
                {rating > 0 ? "Your rating:" : "Seen it? Rate:"}
              </span>
              <StarRating value={rating} onChange={onRate} size="sm" label={`Rate ${movie.title}`} />
            </div>
            <div style={{ marginTop: "0.5rem" }}>
              <button
                className="btn-secondary btn-sm"
                disabled={isWatched || inWatchlist || rating > 0}
                aria-label={
                  isWatched || rating > 0
                    ? `${movie.title} already watched`
                    : inWatchlist
                    ? `${movie.title} already in watchlist`
                    : `Add ${movie.title} to watchlist`
                }
                onClick={onWatchlist}
              >
                {isWatched || rating > 0 ? "✓ Watched" : inWatchlist ? "✓ Watchlist" : "+ Watchlist"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

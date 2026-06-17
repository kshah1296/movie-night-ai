"use client";

import StarRating from "@/components/StarRating";
import Poster from "@/components/Poster";
import RatingBadges from "@/components/RatingBadges";
import type { MovieRatings } from "@/lib/api";

export interface MovieCardData {
  id: number;
  title: string;
  poster_path: string | null;
  vote_average: number;
  metaLine: string;       // e.g. "1999 · Sci-Fi, Action"
  body: string;           // overview (search) or AI explanation (For You)
  bodyEmphasis?: boolean; // true = brighter, 3-line body (For You explanation style)
  kicker?: string;        // small gradient-purple line above the title, e.g. "Because you loved Heat"
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
  return (
    <div
      className="gradient-border card-in"
      style={{ overflow: "hidden", cursor: "pointer", animationDelay: `${Math.min(index * 40, 400)}ms` }}
      onClick={onOpen}
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
            color: movie.bodyEmphasis ? "#e4e4e7" : "var(--text-2)",
            fontSize: movie.bodyEmphasis ? "var(--font-sm)" : "var(--font-xs)",
            lineHeight: movie.bodyEmphasis ? 1.5 : 1.4,
            marginBottom: "var(--space-3)",
            display: "-webkit-box",
            WebkitLineClamp: movie.bodyEmphasis ? 3 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}>
            {movie.body}
          </p>

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

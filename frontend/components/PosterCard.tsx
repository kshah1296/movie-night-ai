"use client";

import Image from "next/image";
import StarRating from "@/components/StarRating";
import RatingBadges from "@/components/RatingBadges";
import { posterUrl } from "@/lib/tmdb";
import type { MovieRatings } from "@/lib/api";

export interface PosterCardData {
  id: number;
  title: string;
  poster_path: string | null;
  vote_average: number;
  metaLine: string; // e.g. "1999 · Sci-Fi, Action"
}

interface PosterCardProps {
  movie: PosterCardData;
  index: number;        // for the .card-in stagger
  rating: number;       // 0 = unrated
  inWatchlist: boolean;
  isWatched: boolean;
  ratings?: MovieRatings; // external critic/audience scores (IMDb/RT/MC)
  onOpen: () => void;
  onRate: (rating: number) => void;
  onWatchlist: () => void;
}

/** Poster-forward card for Discover: the poster is the hero; title/meta sit beneath,
 * with inline rate + watchlist preserved (overview lives in the modal). */
export default function PosterCard({
  movie, index, rating, inWatchlist, isWatched, ratings, onOpen, onRate, onWatchlist,
}: PosterCardProps) {
  const poster = posterUrl(movie.poster_path);
  const saved = isWatched || inWatchlist || rating > 0;

  return (
    <div
      className="gradient-border card-in"
      data-card
      role="button"
      tabIndex={0}
      aria-label={`${movie.title} — open details`}
      style={{
        overflow: "hidden", cursor: "pointer", display: "flex", flexDirection: "column",
        animationDelay: `${Math.min(index * 40, 400)}ms`,
      }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div
        className="poster-frame"
        style={{
          position: "relative", width: "100%", aspectRatio: "2/3",
          background: "var(--surface-2)", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {poster ? (
          <Image
            src={poster}
            alt={movie.title}
            fill
            sizes="(max-width: 520px) 45vw, (max-width: 900px) 30vw, 200px"
            style={{ objectFit: "cover" }}
          />
        ) : (
          <span style={{ fontSize: "2.5rem" }} aria-hidden="true">🎬</span>
        )}
        {movie.vote_average > 0 && (
          <span style={{
            position: "absolute", bottom: 6, left: 6, background: "rgba(0,0,0,0.78)",
            color: "var(--gold)", fontSize: "var(--font-xs)", fontWeight: 700,
            padding: "0.12rem 0.4rem", borderRadius: "999px",
          }}>
            ★ {movie.vote_average.toFixed(1)}
          </span>
        )}
      </div>

      <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "0.35rem", flex: 1 }}>
        <h3 style={{
          fontWeight: 700, fontSize: "var(--font-md)", lineHeight: 1.3,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {movie.title}
        </h3>
        <p style={{ color: "var(--text-2)", fontSize: "var(--font-xs)" }}>
          {movie.metaLine}
        </p>
        <RatingBadges ratings={ratings} />

        <div style={{ marginTop: "auto", paddingTop: "0.4rem" }} onClick={(e) => e.stopPropagation()}>
          <StarRating value={rating} onChange={onRate} size="sm" label={`Rate ${movie.title}`} />
          <button
            className="btn-secondary btn-sm"
            style={{ marginTop: "0.5rem", width: "100%" }}
            disabled={saved}
            aria-label={
              saved
                ? (isWatched || rating > 0 ? `${movie.title} already watched` : `${movie.title} already in watchlist`)
                : `Add ${movie.title} to watchlist`
            }
            onClick={onWatchlist}
          >
            {isWatched || rating > 0 ? "✓ Watched" : inWatchlist ? "✓ Watchlist" : "+ Watchlist"}
          </button>
        </div>
      </div>
    </div>
  );
}

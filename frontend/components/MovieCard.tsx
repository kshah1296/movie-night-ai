"use client";

import Image from "next/image";
import StarRating from "@/components/StarRating";
import { posterUrl } from "@/lib/tmdb";

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
  onOpen: () => void;
  onRate: (rating: number) => void;
  onWatchlist: () => void;
  onDismiss?: () => void; // renders the "not interested" ✕ when provided
}

export default function MovieCard({
  movie, index, rating, inWatchlist, isWatched, onOpen, onRate, onWatchlist, onDismiss,
}: MovieCardProps) {
  const poster = posterUrl(movie.poster_path);

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
      <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
        <div
          className="poster-frame"
          style={{
            position: "relative", width: 100, height: 150, borderRadius: "0.5rem",
            overflow: "hidden", flexShrink: 0, background: "#27272a",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {poster ? (
            <Image src={poster} alt={movie.title} width={100} height={150}
              style={{ objectFit: "cover", width: "100%", height: "100%" }} />
          ) : (
            <span style={{ fontSize: "2rem" }}>🎬</span>
          )}
          {movie.vote_average > 0 && (
            <span style={{
              position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.75)",
              color: "#fbbf24", fontSize: "0.65rem", fontWeight: 700,
              padding: "0.1rem 0.35rem", borderRadius: "999px",
            }}>
              ★ {movie.vote_average.toFixed(1)}
            </span>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {movie.kicker && (
            <p style={{
              color: "#a855f7",
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
          <p style={{ color: "#a1a1aa", fontSize: "0.75rem", marginBottom: "0.4rem" }}>
            {movie.metaLine}
          </p>
          <p style={{
            color: movie.bodyEmphasis ? "#e4e4e7" : "#a1a1aa",
            fontSize: movie.bodyEmphasis ? "0.8rem" : "0.75rem",
            lineHeight: movie.bodyEmphasis ? 1.5 : 1.4,
            marginBottom: "0.75rem",
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
                className="btn-secondary"
                style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem" }}
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

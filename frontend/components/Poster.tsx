"use client";

import Image from "next/image";
import { posterUrl } from "@/lib/tmdb";

interface PosterProps {
  path: string | null;
  alt: string;
  width?: number;
  height?: number;
  voteAverage?: number; // shows the ★ score badge (bottom-left) when > 0
  watched?: boolean;    // shows the ✓ watched badge (top-right)
}

/** Shared poster frame: image or 🎬 fallback, with optional score / watched badges.
 * Replaces the hand-duplicated poster block in MovieCard, watchlist and ratings. */
export default function Poster({
  path, alt, width = 100, height = 150, voteAverage, watched,
}: PosterProps) {
  const url = posterUrl(path);
  return (
    <div
      className="poster-frame"
      style={{
        position: "relative", width, height, borderRadius: "var(--radius-sm)",
        overflow: "hidden", flexShrink: 0, background: "var(--surface-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {url ? (
        <Image src={url} alt={alt} width={width} height={height}
          style={{ objectFit: "cover", width: "100%", height: "100%" }} />
      ) : (
        <span style={{ fontSize: "2rem" }} aria-hidden="true">🎬</span>
      )}
      {voteAverage != null && voteAverage > 0 && (
        <span style={{
          position: "absolute", bottom: 4, left: 4, background: "rgba(0,0,0,0.75)",
          color: "var(--gold)", fontSize: "var(--font-xs)", fontWeight: 700,
          padding: "0.1rem 0.35rem", borderRadius: "999px",
        }}>
          ★ {voteAverage.toFixed(1)}
        </span>
      )}
      {watched && (
        <div
          role="img"
          aria-label="Watched"
          style={{
            position: "absolute", top: 4, right: 4, width: 24, height: 24,
            background: "var(--gradient-2)", borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.7rem", color: "var(--text-on-accent)", fontWeight: 700,
          }}
        >
          <span aria-hidden="true">✓</span>
        </div>
      )}
    </div>
  );
}

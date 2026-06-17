"use client";

import { rtIsFresh } from "@/lib/ratings";
import type { MovieRatings } from "@/lib/api";

interface Props {
  ratings?: MovieRatings | null;
  tmdb?: number;      // optional TMDB score, rendered as the first badge (modal only)
  imdbLink?: boolean; // link the IMDb badge to imdb.com (used in the modal)
  style?: React.CSSProperties;
}

/** Compact score row: TMDB · 🍅 RT · IMDb · MC, all rendered as identical pills.
 * Skips any missing metric and renders nothing when all are absent — so the
 * no-key / no-data state looks unchanged. Brand colors stay hardcoded. */
export default function RatingBadges({ ratings, tmdb, imdbLink = false, style }: Props) {
  const { imdb, rotten_tomatoes: rt, metacritic: mc, imdb_id } = ratings ?? {};
  const hasTmdb = typeof tmdb === "number" && tmdb > 0;
  if (!hasTmdb && !imdb && !rt && !mc) return null;

  return (
    <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", alignItems: "center", ...style }}>
      {hasTmdb && <Badge label="TMDB" value={`★ ${tmdb!.toFixed(1)}`} color="#facc15" />}
      {rt && (
        <Badge
          label={rtIsFresh(rt) ? "🍅" : "🤢"}
          value={rt}
          color={rtIsFresh(rt) ? "#fa320a" : "#5fae3a"}
        />
      )}
      {imdb && (
        <Badge
          label="IMDb"
          value={imdb}
          color="#f5c518"
          href={imdbLink && imdb_id ? `https://www.imdb.com/title/${imdb_id}/` : undefined}
        />
      )}
      {mc && <Badge label="MC" value={mc.replace("/100", "")} color="#6dc849" />}
    </div>
  );
}

function Badge({ label, value, color, href }: { label: string; value: string; color: string; href?: string }) {
  const inner = (
    <>
      <span style={{ color: "var(--text-3)", fontWeight: 600 }}>{label}</span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </>
  );
  const s: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "0.2rem",
    background: "var(--surface-2)", borderRadius: "0.4rem",
    padding: "0.1rem 0.4rem", fontSize: "var(--font-xs)", lineHeight: 1.5,
    textDecoration: "none",
  };
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" style={s}
      onClick={(e) => e.stopPropagation()} title={`${label} ${value} — open on IMDb`}>
      {inner}
    </a>
  ) : (
    <span style={s} title={`${label} ${value}`}>{inner}</span>
  );
}

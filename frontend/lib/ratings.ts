"use client";

import { useEffect, useState } from "react";
import { getMovieRatingsBatch, type MovieRatings } from "@/lib/api";

// "91%" -> true if the RT Tomatometer is Fresh (>= 60%). Shared by cards + modal.
export function rtIsFresh(value: string): boolean {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? true : n >= 60;
}

// Session-scoped cache so a movie's ratings are fetched at most once per page session,
// even as it appears across Discover / For You / Watchlist / Ratings and infinite scroll.
const cache = new Map<number, MovieRatings>();
const inflight = new Map<number, Promise<void>>();
const CHUNK = 20;

function ensure(ids: number[]): Promise<void> {
  const need = ids.filter((id) => !cache.has(id) && !inflight.has(id));
  const work: Promise<void>[] = [];

  for (let i = 0; i < need.length; i += CHUNK) {
    const chunk = need.slice(i, i + CHUNK);
    const p = getMovieRatingsBatch(chunk)
      .then((res) => { for (const id of chunk) cache.set(id, res[String(id)] ?? {}); })
      .catch(() => { for (const id of chunk) cache.set(id, {}); }) // cache empty on failure (no hammering)
      .finally(() => { for (const id of chunk) inflight.delete(id); });
    for (const id of chunk) inflight.set(id, p);
    work.push(p);
  }
  // Also wait on any chunk already in flight that covers ids we were asked about.
  for (const id of ids) {
    const p = inflight.get(id);
    if (p && !need.includes(id)) work.push(p);
  }
  return Promise.all(work).then(() => undefined);
}

/** Returns a map of tmdb_id -> ratings for the given ids, fetching (batched, deduped)
 * any that aren't cached yet and re-rendering when they arrive. */
export function useCardRatings(ids: number[]): Record<number, MovieRatings> {
  const [, force] = useState(0);
  const key = ids.join(",");

  useEffect(() => {
    let alive = true;
    if (ids.length) ensure(ids).then(() => { if (alive) force((n) => n + 1); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const out: Record<number, MovieRatings> = {};
  for (const id of ids) {
    const r = cache.get(id);
    if (r) out[id] = r;
  }
  return out;
}

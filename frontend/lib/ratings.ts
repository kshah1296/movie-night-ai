"use client";

import { useEffect, useState } from "react";
import { getMovieRatingsBatch, type MovieRatings } from "@/lib/api";

// "91%" -> true if the RT Tomatometer is Fresh (>= 60%). Shared by cards + modal.
export function rtIsFresh(value: string): boolean {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? true : n >= 60;
}

// Session-scoped cache. Real scores are cached for FRESH_MS; an empty/failed result is
// only held briefly so a transient backend hiccup re-tries instead of showing blank
// badges for the whole session (audit H6).
interface Entry { ratings: MovieRatings; ts: number }
const cache = new Map<number, Entry>();
const inflight = new Map<number, Promise<void>>();
const CHUNK = 20;
const FRESH_MS = 10 * 60 * 1000;   // movies with scores
const EMPTY_RETRY_MS = 60 * 1000;  // empty/failed — short, so we retry

function hasScores(r: MovieRatings): boolean {
  return !!(r && (r.imdb || r.rotten_tomatoes || r.metacritic));
}

function isStale(e: Entry): boolean {
  return Date.now() - e.ts > (hasScores(e.ratings) ? FRESH_MS : EMPTY_RETRY_MS);
}

function ensure(ids: number[]): Promise<void> {
  const need = ids.filter((id) => {
    const e = cache.get(id);
    return (!e || isStale(e)) && !inflight.has(id);
  });
  const work: Promise<void>[] = [];

  for (let i = 0; i < need.length; i += CHUNK) {
    const chunk = need.slice(i, i + CHUNK);
    const p = getMovieRatingsBatch(chunk)
      .then((res) => {
        const now = Date.now();
        for (const id of chunk) cache.set(id, { ratings: res[String(id)] ?? {}, ts: now });
      })
      .catch(() => {
        // Only mark missing ids empty (with a short TTL); never overwrite good data.
        const now = Date.now();
        for (const id of chunk) if (!cache.get(id)) cache.set(id, { ratings: {}, ts: now });
      })
      .finally(() => { for (const id of chunk) inflight.delete(id); });
    for (const id of chunk) inflight.set(id, p);
    work.push(p);
  }
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
    const e = cache.get(id);
    if (e) out[id] = e.ratings;
  }
  return out;
}

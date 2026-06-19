"use client";

import { useEffect, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface WatchMeta {
  runtime: number | null;
  providers: number[]; // US flatrate (streaming) provider ids
}

// Session cache so the watchlist's runtime/provider data is fetched at most once per id.
const cache = new Map<number, WatchMeta>();
const inflight = new Map<number, Promise<void>>();
const CHUNK = 40;

async function fetchBatch(ids: number[]): Promise<Record<string, WatchMeta>> {
  const res = await fetch(`${BASE}/movies/meta?ids=${ids.join(",")}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`meta failed: ${res.status}`);
  return res.json();
}

function ensure(ids: number[]): Promise<void> {
  const need = ids.filter((id) => !cache.has(id) && !inflight.has(id));
  const work: Promise<void>[] = [];
  for (let i = 0; i < need.length; i += CHUNK) {
    const chunk = need.slice(i, i + CHUNK);
    const p = fetchBatch(chunk)
      .then((res) => {
        for (const id of chunk) cache.set(id, res[String(id)] ?? { runtime: null, providers: [] });
      })
      .catch(() => {
        for (const id of chunk) if (!cache.has(id)) cache.set(id, { runtime: null, providers: [] });
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

/** Returns {tmdb_id -> {runtime, providers}} for the given ids, fetching (batched) what's missing. */
export function useWatchMeta(ids: number[]): Record<number, WatchMeta> {
  const [, force] = useState(0);
  const key = ids.join(",");
  useEffect(() => {
    let alive = true;
    if (ids.length) ensure(ids).then(() => { if (alive) force((n) => n + 1); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const out: Record<number, WatchMeta> = {};
  for (const id of ids) {
    const m = cache.get(id);
    if (m) out[id] = m;
  }
  return out;
}

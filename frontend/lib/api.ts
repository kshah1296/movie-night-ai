const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface TmdbMovie {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  genre_ids: number[];
  overview: string;
  vote_average: number;
}

export interface MovieListResult {
  results: TmdbMovie[];
  total_pages: number;
  total_results: number;
  page: number;
}

export interface Rating {
  id: number;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  genres: string[];
  year: number | null;
  rating: number;
  created_at: string;
}

export interface WatchlistItem {
  id: number;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  genres: string[];
  year: number | null;
  watched: boolean;
  post_watch_rating: number | null;
  added_at: string;
  watched_at: string | null;
}

export interface Recommendation {
  tmdb_id: number;
  title: string;
  year: number | null;
  explanation: string;
  anchor?: string | null;   // loved movie this pick traces back to (nearest by Taste DNA)
  channel?: string;         // retrieval channel: similar | keywords | people | hidden-gem | popular | wildcard
  bucket?: string;          // product bucket: Safe Picks | Hidden Gems | Expand Your Taste | …
  bucket_reason?: string;   // one-line why-this-bucket
  genres: string[];
  poster_path: string | null;
  vote_average: number;
  overview: string;
}

export interface TasteInfo {
  keywords: string[];
  people: string[];
  genres: string[];
  dna?: string[];           // top Taste-DNA traits, e.g. ["slow-burn","character-driven","cerebral"]
  confidence?: number;      // 0..1 — how sure the taste model is (low when cold-starting)
  tone: string;
}

export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
}

export interface MovieProviders {
  link?: string;
  flatrate?: WatchProvider[];
  rent?: WatchProvider[];
  buy?: WatchProvider[];
}

export interface MovieDetail {
  id: number;
  title: string;
  tagline: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  runtime: number;
  vote_average: number;
  genres: { id: number; name: string }[];
  credits: {
    cast: { id: number; name: string; character: string; profile_path: string | null }[];
  };
  videos?: {
    results: { id: string; key: string; site: string; type: string; official: boolean; name: string }[];
  };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Movies
export const searchMovies = (q: string, page = 1, year?: number) =>
  req<MovieListResult>(
    `/movies/search?q=${encodeURIComponent(q)}&page=${page}${year ? `&year=${year}` : ""}`
  );

export const getTrendingMovies = (page = 1) =>
  req<MovieListResult>(`/movies/trending?page=${page}`);

export interface DiscoverParams {
  page?: number;
  sortBy?: string;
  genres?: number[];
  yearGte?: number;
  yearLte?: number;
  minRating?: number;
  runtimeGte?: number;
  runtimeLte?: number;
  providers?: number[];
  people?: number[];
  keywords?: number[];
}

export const discoverMovies = (p: DiscoverParams = {}) => {
  const qs = new URLSearchParams();
  qs.set("page", String(p.page ?? 1));
  if (p.sortBy) qs.set("sort_by", p.sortBy);
  if (p.genres?.length) qs.set("genres", p.genres.join(","));
  if (p.yearGte != null) qs.set("year_gte", String(p.yearGte));
  if (p.yearLte != null) qs.set("year_lte", String(p.yearLte));
  if (p.minRating != null) qs.set("min_rating", String(p.minRating));
  if (p.runtimeGte != null) qs.set("runtime_gte", String(p.runtimeGte));
  if (p.runtimeLte != null) qs.set("runtime_lte", String(p.runtimeLte));
  if (p.providers?.length) qs.set("providers", p.providers.join(","));
  if (p.people?.length) qs.set("people", p.people.join(","));
  if (p.keywords?.length) qs.set("keywords", p.keywords.join(","));
  return req<MovieListResult>(`/movies/discover?${qs.toString()}`);
};

export interface PersonResult {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string;
  known_for: string[];
}

export const searchPeople = (q: string) =>
  req<PersonResult[]>(`/movies/person_search?q=${encodeURIComponent(q)}`);

export const getMovieDetail = (tmdb_id: number) =>
  req<MovieDetail>(`/movies/${tmdb_id}`);

export const getMovieProviders = (tmdb_id: number) =>
  req<MovieProviders>(`/movies/${tmdb_id}/providers`);

export interface MovieRatings {
  imdb?: string | null;            // "8.8"
  imdb_votes?: string | null;      // "2,400,123"
  imdb_id?: string | null;         // "tt1375666"
  rotten_tomatoes?: string | null; // "91%"
  metacritic?: string | null;      // "74/100"
}

export const getMovieRatings = (tmdb_id: number) =>
  req<MovieRatings>(`/movies/${tmdb_id}/ratings`);

// Batch — returns a map keyed by tmdb_id (as a string), each value possibly empty {}.
export const getMovieRatingsBatch = (ids: number[]) =>
  req<Record<string, MovieRatings>>(`/movies/ratings?ids=${ids.join(",")}`);

// Ratings
export const getRatings = () => req<Rating[]>("/ratings");

export const upsertRating = (data: {
  tmdb_id: number;
  title: string;
  poster_path?: string | null;
  genres?: string[];
  year?: number | null;
  rating: number;
}) =>
  req<Rating>("/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

export const deleteRating = (tmdb_id: number) =>
  req<{ message: string }>(`/ratings/${tmdb_id}`, { method: "DELETE" });

// Watchlist
export const getWatchlist = () => req<WatchlistItem[]>("/watchlist");

export const addToWatchlist = (data: {
  tmdb_id: number;
  title: string;
  poster_path?: string | null;
  genres?: string[];
  year?: number | null;
  watched?: boolean;
  post_watch_rating?: number;
}) =>
  req<WatchlistItem>("/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

// Rates + marks watched in ONE atomic backend transaction (audit M1) — replaces the
// previous two sequential calls that could leave a half-updated state on partial failure.
export const rateAndAddWatched = (data: {
  tmdb_id: number;
  title: string;
  poster_path?: string | null;
  genres?: string[];
  year?: number | null;
  rating: number;
}) =>
  req<Rating>("/ratings/rate-and-watch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

export const updateWatchlistItem = (
  tmdb_id: number,
  data: { watched?: boolean; post_watch_rating?: number | null }
) =>
  req<WatchlistItem>(`/watchlist/${tmdb_id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

export const removeFromWatchlist = (tmdb_id: number) =>
  req<{ message: string }>(`/watchlist/${tmdb_id}`, { method: "DELETE" });

// Recommendations
export const getRecommendations = (refresh = 0, genre?: string, mood?: string, providers?: number[]) =>
  req<{ recommendations: Recommendation[]; message?: string; source?: string; taste?: TasteInfo; cold_start?: boolean }>(
    `/recommendations?refresh=${refresh}` +
      (genre ? `&genre=${encodeURIComponent(genre)}` : "") +
      (mood ? `&mood=${encodeURIComponent(mood)}` : "") +
      (providers?.length ? `&providers=${providers.join(",")}` : "")
  );

// Rec feedback
export const sendRecFeedback = (data: { tmdb_id: number; title?: string }) =>
  req<{ id: number }>("/rec_feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "not_interested", ...data }),
  });

export const undoRecFeedback = (tmdb_id: number) =>
  req<{ message: string }>(`/rec_feedback/${tmdb_id}`, { method: "DELETE" });

// Implicit-feedback events that power /analytics. Fire-and-forget — never blocks the
// UI and never throws (analytics is best-effort).
export type RecEventType =
  | "click" | "trailer" | "share" | "watchlist_add" | "watchlist_remove" | "skip";

export function logEvent(
  tmdb_id: number,
  event_type: RecEventType,
  opts?: { bucket?: string | null; position?: number },
): void {
  req("/events/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tmdb_id, event_type, bucket: opts?.bucket ?? undefined, position: opts?.position,
    }),
  }).catch(() => {});
}

// Taste DNA profile (UX18)
export interface TasteAxis {
  axis: string;
  neg: string;
  pos: string;
  value: number;       // -1..1
  confidence: number;  // 0..1
  lean: string;
}

export interface TasteProfile {
  has_profile: boolean;
  n_ratings: number;
  mean_confidence: number;
  axes: TasteAxis[];
  traits: string[];
  genres: { name: string; score: number }[];
  people: { name: string; score: number }[];
  keywords: string[];
  updated_at: string | null;
}

export const getTasteProfile = () => req<TasteProfile>("/taste/");

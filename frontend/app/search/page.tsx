"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  searchMovies,
  discoverMovies,
  getTrendingMovies,
  searchPeople,
  rateAndAddWatched,
  addToWatchlist,
  deleteRating,
  getRatings,
  getWatchlist,
  type TmdbMovie,
  type Rating,
  type MovieListResult,
  type PersonResult,
  type DiscoverParams,
} from "@/lib/api";
import { genreIdsToNames, GENRE_MAP } from "@/lib/tmdb";
import { useCardRatings } from "@/lib/ratings";
import PosterCard from "@/components/PosterCard";
import MovieModal from "@/components/MovieModal";
import Toast from "@/components/Toast";
import { SkeletonGrid } from "@/components/SkeletonCard";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

// ---------- Filter vocabulary ----------

const SORTS = [
  { key: "trending", label: "📈 Trending" },
  { key: "popularity.desc", label: "🔥 Most Popular" },
  { key: "vote_average.desc", label: "⭐ Highest Rated" },
  { key: "primary_release_date.desc", label: "🆕 Newest" },
];

const DECADES: { key: string; label: string; gte?: number; lte?: number }[] = [
  { key: "2020", label: "2020s", gte: 2020, lte: 2029 },
  { key: "2010", label: "2010s", gte: 2010, lte: 2019 },
  { key: "2000", label: "2000s", gte: 2000, lte: 2009 },
  { key: "1990", label: "90s", gte: 1990, lte: 1999 },
  { key: "1980", label: "80s", gte: 1980, lte: 1989 },
  { key: "older", label: "Before 1980", lte: 1979 },
];

const RATING_OPTIONS = [6, 7, 8];

const RUNTIMES: { key: string; label: string; gte?: number; lte?: number }[] = [
  { key: "short", label: "< 90 min", lte: 90 },
  { key: "mid", label: "90–120 min", gte: 90, lte: 120 },
  { key: "long", label: "2h+", gte: 120 },
];

// TMDB US watch-provider ids
const PROVIDERS = [
  { id: 8, label: "Netflix" },
  { id: 9, label: "Prime Video" },
  { id: 337, label: "Disney+" },
  { id: 15, label: "Hulu" },
  { id: 1899, label: "Max" },
  { id: 350, label: "Apple TV+" },
  { id: 531, label: "Paramount+" },
  { id: 386, label: "Peacock" },
];

const GENRES = Object.entries(GENRE_MAP)
  .map(([id, name]) => ({ id: Number(id), name }))
  .filter((g) => g.id !== 10770) // TV Movie is noise for a movie-night app
  .sort((a, b) => a.name.localeCompare(b.name));

// ---------- URL state helpers ----------

interface Filters {
  q: string;
  sort: string;
  genres: number[];
  decade: string | null;
  minRating: number | null;
  runtime: string | null;
  providers: number[];
  personId: number | null;
  personName: string | null;
}

function parseFilters(sp: { get(name: string): string | null }): Filters {
  return {
    q: sp.get("q") ?? "",
    sort: sp.get("sort") ?? "trending",
    genres: (sp.get("genres") ?? "").split(",").filter(Boolean).map(Number),
    decade: sp.get("decade"),
    minRating: sp.get("min") ? Number(sp.get("min")) : null,
    runtime: sp.get("runtime"),
    providers: (sp.get("on") ?? "").split(",").filter(Boolean).map(Number),
    personId: sp.get("person") ? Number(sp.get("person")) : null,
    personName: sp.get("personName"),
  };
}

function filtersToQueryString(f: Filters): string {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.sort !== "trending") sp.set("sort", f.sort);
  if (f.genres.length) sp.set("genres", f.genres.join(","));
  if (f.decade) sp.set("decade", f.decade);
  if (f.minRating != null) sp.set("min", String(f.minRating));
  if (f.runtime) sp.set("runtime", f.runtime);
  if (f.providers.length) sp.set("on", f.providers.join(","));
  if (f.personId != null) {
    sp.set("person", String(f.personId));
    if (f.personName) sp.set("personName", f.personName);
  }
  return sp.toString();
}

function countActiveFilters(f: Filters): number {
  return (
    (f.genres.length ? 1 : 0) +
    (f.decade ? 1 : 0) +
    (f.minRating != null ? 1 : 0) +
    (f.runtime ? 1 : 0) +
    (f.providers.length ? 1 : 0) +
    (f.personId != null ? 1 : 0)
  );
}

interface ActiveChip {
  label: string;
  clear: (f: Filters) => Filters;
}

function activeFilterChips(f: Filters): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (f.personId != null) {
    chips.push({
      label: `🎭 ${f.personName ?? "Person"}`,
      clear: (x) => ({ ...x, personId: null, personName: null }),
    });
  }
  f.genres.forEach((id) => {
    chips.push({
      label: GENRE_MAP[id] ?? `Genre ${id}`,
      clear: (x) => ({ ...x, genres: x.genres.filter((g) => g !== id) }),
    });
  });
  const d = DECADES.find((x) => x.key === f.decade);
  if (d) chips.push({ label: d.label, clear: (x) => ({ ...x, decade: null }) });
  if (f.minRating != null) {
    chips.push({ label: `${f.minRating}+ ★`, clear: (x) => ({ ...x, minRating: null }) });
  }
  const r = RUNTIMES.find((x) => x.key === f.runtime);
  if (r) chips.push({ label: r.label, clear: (x) => ({ ...x, runtime: null }) });
  f.providers.forEach((id) => {
    const p = PROVIDERS.find((x) => x.id === id);
    chips.push({
      label: p?.label ?? `Provider ${id}`,
      clear: (x) => ({ ...x, providers: x.providers.filter((v) => v !== id) }),
    });
  });
  return chips;
}

function toDiscoverParams(f: Filters, page: number): DiscoverParams {
  const d = DECADES.find((x) => x.key === f.decade);
  const r = RUNTIMES.find((x) => x.key === f.runtime);
  return {
    page,
    sortBy: f.sort === "trending" ? "popularity.desc" : f.sort,
    genres: f.genres.length ? f.genres : undefined,
    yearGte: d?.gte,
    yearLte: d?.lte,
    minRating: f.minRating ?? undefined,
    runtimeGte: r?.gte,
    runtimeLte: r?.lte,
    providers: f.providers.length ? f.providers : undefined,
    people: f.personId != null ? [f.personId] : undefined,
  };
}

function fetchList(f: Filters, page: number): Promise<MovieListResult> {
  const q = f.q.trim();
  if (q) return searchMovies(q, page);
  if (f.sort === "trending" && countActiveFilters(f) === 0) return getTrendingMovies(page);
  return discoverMovies(toDiscoverParams(f, page));
}

function dedupeAppend(prev: TmdbMovie[], next: TmdbMovie[]): TmdbMovie[] {
  const seen = new Set(prev.map((m) => m.id));
  return [...prev, ...next.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))];
}

// ---------- Page shell with required Suspense boundary ----------

export default function SearchPage() {
  return (
    <Suspense fallback={<SkeletonGrid count={12} variant="poster" />}>
      <SearchPageInner />
    </Suspense>
  );
}

// ---------- Inner component (can use useSearchParams) ----------

function SearchPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const isSearchMode = filters.q.trim().length > 0;
  const activeCount = countActiveFilters(filters);

  const [input, setInput] = useState(filters.q);
  const [results, setResults] = useState<TmdbMovie[]>([]);
  const [people, setPeople] = useState<PersonResult[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [watchlisted, setWatchlisted] = useState<Record<number, boolean>>({});
  const [watched, setWatched] = useState<Record<number, boolean>>({});
  const [toast, setToast] = useState("");
  const [modalId, setModalId] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef(filters);
  const fetchKeyRef = useRef("");
  const readyKeyRef = useRef("");      // key whose page-1 has actually resolved (P2-10)
  const loadMoreBusyRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { filtersRef.current = filters; }, [filters]);
  // Keep input in sync with back/forward navigation
  useEffect(() => { setInput(filters.q); }, [filters.q]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ----- URL writing -----
  const applyFilters = useCallback(
    (next: Filters) => {
      const qs = filtersToQueryString(next);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname]
  );

  function onInputChange(value: string) {
    setInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      applyFilters({ ...filtersRef.current, q: value });
    }, 400);
  }

  function selectPerson(p: PersonResult) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setInput("");
    applyFilters({ ...filtersRef.current, q: "", personId: p.id, personName: p.name });
  }

  function clearAllFilters() {
    applyFilters({
      ...filters,
      genres: [], decade: null, minRating: null, runtime: null,
      providers: [], personId: null, personName: null,
    });
  }

  // ----- Saved ratings / watchlist (badge state on cards) -----
  useEffect(() => {
    Promise.all([getRatings(), getWatchlist()])
      .then(([ratingData, watchlistData]) => {
        const ratingMap: Record<number, number> = {};
        ratingData.forEach((r: Rating) => { ratingMap[r.tmdb_id] = r.rating; });
        const watchlistedMap: Record<number, boolean> = {};
        const watchedMap: Record<number, boolean> = {};
        watchlistData.forEach((item) => {
          watchlistedMap[item.tmdb_id] = true;
          if (item.watched) {
            watchedMap[item.tmdb_id] = true;
            if (!ratingMap[item.tmdb_id] && item.post_watch_rating) {
              ratingMap[item.tmdb_id] = item.post_watch_rating;
            }
          }
        });
        setRatings(ratingMap);
        setWatchlisted(watchlistedMap);
        setWatched(watchedMap);
      })
      .catch(() => {});
  }, []);

  // ----- THE data fetch: one effect, keyed on the URL -----
  useEffect(() => {
    const key = paramsKey;
    fetchKeyRef.current = key;
    loadMoreBusyRef.current = false; // cancel any in-flight load-more guard from the old query
    const f = parseFilters(new URLSearchParams(key));
    setLoading(true);
    setError("");
    setPage(1);

    fetchList(f, 1)
      .then((data) => {
        if (fetchKeyRef.current !== key) return;
        setResults(dedupeAppend([], data.results ?? []));
        setTotalPages(data.total_pages ?? 1);
        setTotalResults(data.total_results ?? 0);
        readyKeyRef.current = key; // page-1 is in — load-more may now proceed for this key
      })
      .catch(() => {
        if (fetchKeyRef.current !== key) return;
        setResults([]);
        setTotalResults(0);
        setError("Failed to load movies. Is the backend running?");
      })
      .finally(() => {
        if (fetchKeyRef.current === key) setLoading(false);
      });

    // Person matches ride along with text search
    const q = f.q.trim();
    if (q.length >= 2) {
      searchPeople(q)
        .then((p) => { if (fetchKeyRef.current === key) setPeople(p.slice(0, 3)); })
        .catch(() => {});
    } else {
      setPeople([]);
    }
  }, [paramsKey]);

  // ----- Infinite scroll -----
  const loadMore = useCallback(async () => {
    if (loadMoreBusyRef.current || loading || page >= totalPages) return;
    // Never fetch page 2 before page 1 of the CURRENT query has resolved (P2-10).
    if (readyKeyRef.current !== fetchKeyRef.current) return;
    loadMoreBusyRef.current = true;
    setLoadingMore(true);
    const key = fetchKeyRef.current;
    const f = parseFilters(new URLSearchParams(key));
    const next = page + 1;
    try {
      const data = await fetchList(f, next);
      if (fetchKeyRef.current !== key) return;
      setResults((prev) => dedupeAppend(prev, data.results ?? []));
      setPage(next);
      setTotalPages(data.total_pages ?? 1);
    } catch {
      if (fetchKeyRef.current === key) setToast("Couldn't load more movies");
    } finally {
      loadMoreBusyRef.current = false;
      setLoadingMore(false);
    }
  }, [loading, page, totalPages]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: "600px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  // ----- Optimistic mutations -----
  async function handleRate(movie: TmdbMovie, rating: number) {
    const year = movie.release_date ? parseInt(movie.release_date.split("-")[0]) : null;
    const genres = genreIdsToNames(movie.genre_ids);
    const prevRating = ratings[movie.id] ?? 0;
    const prevWatchlisted = watchlisted[movie.id] ?? false;
    const prevWatched = watched[movie.id] ?? false;

    if (rating === 0) {
      setRatings((prev) => { const n = { ...prev }; delete n[movie.id]; return n; });
      setToast(`Removed rating for "${movie.title}"`);
    } else {
      setRatings((prev) => ({ ...prev, [movie.id]: rating }));
      setWatchlisted((prev) => ({ ...prev, [movie.id]: true }));
      setWatched((prev) => ({ ...prev, [movie.id]: true }));
      setToast(`Rated "${movie.title}" ${rating}★ · Added to Watched`);
    }

    try {
      if (rating === 0) await deleteRating(movie.id);
      else await rateAndAddWatched({ tmdb_id: movie.id, title: movie.title, poster_path: movie.poster_path, genres, year, rating });
    } catch {
      if (prevRating === 0) setRatings((prev) => { const n = { ...prev }; delete n[movie.id]; return n; });
      else setRatings((prev) => ({ ...prev, [movie.id]: prevRating }));
      setWatchlisted((prev) => ({ ...prev, [movie.id]: prevWatchlisted }));
      setWatched((prev) => ({ ...prev, [movie.id]: prevWatched }));
      setToast("Couldn't save — is the backend running?");
    }
  }

  async function handleWatchlist(movie: TmdbMovie) {
    const year = movie.release_date ? parseInt(movie.release_date.split("-")[0]) : null;
    const genres = genreIdsToNames(movie.genre_ids);
    const prevWatchlisted = watchlisted[movie.id] ?? false;

    setWatchlisted((prev) => ({ ...prev, [movie.id]: true }));
    setToast(`Added "${movie.title}" to watchlist`);

    try {
      await addToWatchlist({ tmdb_id: movie.id, title: movie.title, poster_path: movie.poster_path, genres, year });
    } catch {
      setWatchlisted((prev) => ({ ...prev, [movie.id]: prevWatchlisted }));
      setToast("Couldn't save — is the backend running?");
    }
  }

  // ----- Derived display bits -----
  const effectiveSortKey =
    !isSearchMode && activeCount > 0 && filters.sort === "trending" ? "popularity.desc" : filters.sort;
  const sortLabel = SORTS.find((s) => s.key === effectiveSortKey)?.label ?? "";
  const chips = activeFilterChips(filters);

  // Batch-load external scores (IMDb/RT/MC) for the currently loaded results.
  const resultIds = useMemo(() => results.map((m) => m.id), [results]);
  const cardRatings = useCardRatings(resultIds);

  return (
    <div>
      <Toast message={toast} onDismiss={() => setToast("")} />

      {modalId && (
        <MovieModal
          tmdbId={modalId}
          initialRating={ratings[modalId] ?? 0}
          initialWatchlisted={watchlisted[modalId] ?? false}
          onClose={() => setModalId(null)}
          onRated={(id, r) => {
            if (r === 0) setRatings((prev) => { const n = { ...prev }; delete n[id]; return n; });
            else setRatings((prev) => ({ ...prev, [id]: r }));
          }}
          onWatchlisted={(id) => {
            setWatchlisted((prev) => ({ ...prev, [id]: true }));
            setWatched((prev) => ({ ...prev, [id]: true }));
          }}
        />
      )}

      <PageHeader
        title="Discover"
        subtitle="Browse with filters or search by title · click any movie for details"
      />

      <div className="search-wrap">
        <span className="search-icon" aria-hidden="true">🔍</span>
        <input
          type="text"
          className="search-input"
          placeholder="Search by title — or try an actor or director…"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          aria-label="Search movies"
          style={{
            width: "100%", padding: "0.875rem 2.75rem 0.875rem 2.6rem", borderRadius: "0.75rem",
            background: "var(--surface)", border: "1px solid var(--border-strong)",
            color: "var(--text-1)", fontSize: "1rem",
            boxSizing: "border-box",
            transition: "border-color 0.15s",
          }}
        />
        {input && (
          <button
            className="search-clear"
            aria-label="Clear search"
            onClick={() => onInputChange("")}
          >
            ✕
          </button>
        )}
      </div>

      {/* People row — pivot from text search to discover-by-person */}
      {isSearchMode && people.length > 0 && (
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "var(--text-3)", fontSize: "0.75rem" }}>People:</span>
          {people.map((p) => (
            <button key={p.id} className="chip" onClick={() => selectPerson(p)}>
              🎭 {p.name}{p.known_for.length > 0 ? ` · ${p.known_for[0]}` : ""}
            </button>
          ))}
        </div>
      )}

      {/* Discover controls — hidden while text search is active */}
      {!isSearchMode && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <select
            className="select-dark"
            value={filters.sort}
            onChange={(e) => applyFilters({ ...filters, sort: e.target.value })}
            aria-label="Sort by"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <button
            className={`tab${drawerOpen || activeCount > 0 ? " tab-active" : ""}`}
            onClick={() => setDrawerOpen((o) => !o)}
            aria-expanded={drawerOpen}
          >
            ⚙ Filters{activeCount > 0 && <span className="badge-dot">{activeCount}</span>}
          </button>
          {activeCount > 0 && (
            <button className="chip" onClick={clearAllFilters}>✕ Clear all</button>
          )}
        </div>
      )}

      {/* Honest hint instead of fake genre filtering in search mode */}
      {isSearchMode && (
        <p style={{ color: "var(--text-3)", fontSize: "0.75rem", marginBottom: "0.75rem" }}>
          Searching titles · clear the box to browse with filters
        </p>
      )}

      {/* Collapsible filter drawer */}
      {!isSearchMode && drawerOpen && (
        <div className="filter-drawer">
          <div className="filter-row">
            <span className="filter-label">Genres</span>
            {GENRES.map((g) => (
              <button
                key={g.id}
                className={`chip${filters.genres.includes(g.id) ? " chip-active" : ""}`}
                aria-pressed={filters.genres.includes(g.id)}
                onClick={() => applyFilters({
                  ...filters,
                  genres: filters.genres.includes(g.id)
                    ? filters.genres.filter((x) => x !== g.id)
                    : [...filters.genres, g.id],
                })}
              >
                {g.name}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <span className="filter-label">Decade</span>
            {DECADES.map((d) => (
              <button
                key={d.key}
                className={`chip${filters.decade === d.key ? " chip-active" : ""}`}
                aria-pressed={filters.decade === d.key}
                onClick={() => applyFilters({ ...filters, decade: filters.decade === d.key ? null : d.key })}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <span className="filter-label">Rating</span>
            {RATING_OPTIONS.map((r) => (
              <button
                key={r}
                className={`chip${filters.minRating === r ? " chip-active" : ""}`}
                aria-pressed={filters.minRating === r}
                onClick={() => applyFilters({ ...filters, minRating: filters.minRating === r ? null : r })}
              >
                {r}+ ★
              </button>
            ))}
          </div>
          <div className="filter-row">
            <span className="filter-label">Runtime</span>
            {RUNTIMES.map((r) => (
              <button
                key={r.key}
                className={`chip${filters.runtime === r.key ? " chip-active" : ""}`}
                aria-pressed={filters.runtime === r.key}
                onClick={() => applyFilters({ ...filters, runtime: filters.runtime === r.key ? null : r.key })}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <span className="filter-label">On</span>
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                className={`chip${filters.providers.includes(p.id) ? " chip-active" : ""}`}
                aria-pressed={filters.providers.includes(p.id)}
                onClick={() => applyFilters({
                  ...filters,
                  providers: filters.providers.includes(p.id)
                    ? filters.providers.filter((x) => x !== p.id)
                    : [...filters.providers, p.id],
                })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active filter chips — always visible even with drawer closed */}
      {!isSearchMode && chips.length > 0 && (
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          {chips.map((c) => (
            <button key={c.label} className="chip chip-active" onClick={() => applyFilters(c.clear(filters))}>
              {c.label} ✕
            </button>
          ))}
        </div>
      )}

      {error && (
        <EmptyState emoji="📡" title="Couldn't load movies" subtitle={error} />
      )}

      {/* Real result count from total_results, not loaded-page count */}
      {!loading && !error && results.length > 0 && (
        <p style={{ color: "var(--text-2)", fontSize: "var(--font-sm)", marginBottom: "1rem" }}>
          {isSearchMode
            ? `${totalResults.toLocaleString()} results for "${filters.q}"`
            : `${totalResults.toLocaleString()} movies · ${sortLabel}`}
        </p>
      )}

      {loading && <SkeletonGrid count={12} variant="poster" />}

      {!loading && (
        <>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: "var(--space-4)",
          }}>
            {results.map((movie, i) => (
              <PosterCard
                key={movie.id}
                index={i}
                movie={{
                  id: movie.id,
                  title: movie.title,
                  poster_path: movie.poster_path,
                  vote_average: movie.vote_average ?? 0,
                  metaLine: [
                    movie.release_date ? movie.release_date.slice(0, 4) : null,
                    genreIdsToNames(movie.genre_ids).slice(0, 2).join(", ") || null,
                  ].filter(Boolean).join(" · "),
                }}
                rating={ratings[movie.id] ?? 0}
                inWatchlist={watchlisted[movie.id] ?? false}
                isWatched={watched[movie.id] ?? false}
                ratings={cardRatings[movie.id]}
                onOpen={() => setModalId(movie.id)}
                onRate={(r) => handleRate(movie, r)}
                onWatchlist={() => handleWatchlist(movie)}
              />
            ))}
          </div>

          {/* Empty states that suggest which filter to loosen */}
          {results.length === 0 && !error && (
            isSearchMode ? (
              <EmptyState
                emoji="🔍"
                title={`No results for "${filters.q}"`}
                subtitle={people.length > 0
                  ? "Looking for a person? Try the People chips above."
                  : "Check the spelling, or try a shorter title."}
              />
            ) : activeCount > 0 ? (
              <EmptyState
                emoji="🫥"
                title="No movies match all of these filters"
                subtitle="Try removing one:"
              >
                {chips.map((c) => (
                  <button key={c.label} className="chip" onClick={() => applyFilters(c.clear(filters))}>
                    ✕ {c.label}
                  </button>
                ))}
              </EmptyState>
            ) : (
              <p style={{ color: "var(--text-2)", textAlign: "center", paddingTop: "3rem" }}>
                Nothing to show right now.
              </p>
            )
          )}

          {/* Infinite-scroll sentinel; button doubles as manual fallback */}
          {results.length > 0 && page < totalPages && (
            <div ref={sentinelRef} style={{ textAlign: "center", marginTop: "2rem", minHeight: 56 }}>
              {loadingMore ? (
                <span role="status">
                  <span className="spin-icon" aria-hidden="true" style={{ fontSize: "1.5rem", color: "var(--accent)" }}>↻</span>
                  <span className="sr-only">Loading more movies…</span>
                </span>
              ) : (
                <button className="btn-secondary" onClick={loadMore} style={{ minWidth: 140 }}>
                  Load More
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

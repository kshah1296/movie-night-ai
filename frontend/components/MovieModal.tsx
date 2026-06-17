"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  getMovieDetail, getMovieProviders, getMovieRatings, rateAndAddWatched,
  addToWatchlist, deleteRating,
  type MovieDetail, type MovieProviders, type MovieRatings,
} from "@/lib/api";
import { posterUrl } from "@/lib/tmdb";
import { providerLink } from "@/lib/providers";
import StarRating from "@/components/StarRating";
import RatingBadges from "@/components/RatingBadges";
import Toast from "@/components/Toast";

interface Props {
  tmdbId: number;
  initialRating?: number;
  initialWatchlisted?: boolean;
  onClose: () => void;
  onRated?: (tmdbId: number, rating: number) => void;
  onWatchlisted?: (tmdbId: number) => void;
}

export default function MovieModal({
  tmdbId, initialRating = 0, initialWatchlisted = false,
  onClose, onRated, onWatchlisted,
}: Props) {
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [providers, setProviders] = useState<MovieProviders | null>(null);
  const [ratings, setRatings] = useState<MovieRatings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [rating, setRating] = useState(initialRating);
  const [watchlisted, setWatchlisted] = useState(initialWatchlisted);
  const [toast, setToast] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getMovieDetail(tmdbId).then(setMovie).catch(() => setLoadError(true));
    getMovieProviders(tmdbId).then(setProviders).catch(() => {});
    getMovieRatings(tmdbId).then(setRatings).catch(() => {});

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus trap: keep Tab/Shift+Tab inside the dialog; Esc closes (P3-3).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Initial focus sits on the dialog container itself — send the first Tab/Shift+Tab
      // to the correct end so focus can never escape backward out of the modal.
      if (document.activeElement === root) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    // Hide the rest of the app from assistive tech while the dialog is open.
    const main = document.querySelector("main");
    const nav = document.querySelector("nav");
    main?.setAttribute("aria-hidden", "true");
    nav?.setAttribute("aria-hidden", "true");

    // Focus the dialog container (not the ✕) so keyboard users land inside the modal
    // without a focus-visible ring painting on the close button on every open.
    setTimeout(() => dialogRef.current?.focus(), 50);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      main?.removeAttribute("aria-hidden");
      nav?.removeAttribute("aria-hidden");
      previouslyFocused?.focus?.();
    };
  }, [tmdbId, onClose]);

  async function handleRate(r: number) {
    if (!movie) return;
    const genres = movie.genres.map((g) => g.name);
    const year = movie.release_date ? parseInt(movie.release_date.split("-")[0]) : null;
    if (r === 0) {
      await deleteRating(movie.id);
      setRating(0);
      onRated?.(movie.id, 0);
      setToast("Rating removed");
      return;
    }
    await rateAndAddWatched({ tmdb_id: movie.id, title: movie.title, poster_path: movie.poster_path, genres, year, rating: r });
    setRating(r);
    setWatchlisted(true);
    onRated?.(movie.id, r);
    onWatchlisted?.(movie.id);
    setToast(`Rated ${r}★ · Added to Watched`);
  }

  async function handleWatchlist() {
    if (!movie) return;
    const genres = movie.genres.map((g) => g.name);
    const year = movie.release_date ? parseInt(movie.release_date.split("-")[0]) : null;
    await addToWatchlist({ tmdb_id: movie.id, title: movie.title, poster_path: movie.poster_path, genres, year });
    setWatchlisted(true);
    onWatchlisted?.(movie.id);
    setToast("Added to Watchlist");
  }

  const backdropUrl = movie?.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${movie.backdrop_path}`
    : null;
  const poster = posterUrl(movie?.poster_path);
  const cast = movie?.credits?.cast?.slice(0, 6) ?? [];
  const year = movie?.release_date?.split("-")[0];
  const runtime = movie?.runtime ? `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m` : null;

  const trailer = movie?.videos?.results?.find(
    (v) => v.site === "YouTube" && v.type === "Trailer"
  ) ?? movie?.videos?.results?.find((v) => v.site === "YouTube");

  const streamingProviders = providers?.flatrate ?? [];
  const rentProviders = providers?.rent ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={movie?.title ?? "Movie details"}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
        animation: "modal-backdrop-in 0.2s ease-out",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", borderRadius: "var(--radius-lg)", width: "100%",
          maxWidth: 680, maxHeight: "90vh", overflowY: "auto",
          position: "relative",
          boxShadow: "var(--shadow-lg)",
          outline: "none",
          animation: "modal-pop 0.25s ease-out",
        }}
      >
        <button
          ref={closeRef}
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 10,
            background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.18)",
            backdropFilter: "blur(6px)", borderRadius: "50%",
            width: 44, height: 44, cursor: "pointer", color: "white",
            fontSize: "1.1rem", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ✕
        </button>

        {backdropUrl && (
          <div style={{ width: "100%", aspectRatio: "16/7", overflow: "hidden", borderRadius: "1rem 1rem 0 0", position: "relative" }}>
            <Image src={backdropUrl} alt="" fill style={{ objectFit: "cover", opacity: 0.7 }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--surface) 0%, transparent 60%)" }} />
          </div>
        )}

        {!movie && !loadError && (
          <div className="modal-skel" aria-label="Loading movie details">
            <div className="skeleton" style={{ width: 100, height: 150, flexShrink: 0, borderRadius: "0.5rem" }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.6rem", paddingTop: "0.25rem" }}>
              <div className="skeleton" style={{ height: 22, width: "65%" }} />
              <div className="skeleton" style={{ height: 13, width: "45%" }} />
              <div className="skeleton" style={{ height: 13, width: "30%" }} />
              <div className="skeleton" style={{ height: 12, width: "100%", marginTop: "0.5rem" }} />
              <div className="skeleton" style={{ height: 12, width: "92%" }} />
              <div className="skeleton" style={{ height: 12, width: "60%" }} />
            </div>
          </div>
        )}
        {loadError && (
          <div style={{ padding: "4rem", textAlign: "center", color: "var(--danger)" }}>Failed to load movie details.</div>
        )}

        {movie && (
          <div style={{ padding: "1.5rem" }}>
            {/* Header */}
            <div className="modal-header" style={{ display: "flex", gap: "1.25rem", marginTop: backdropUrl ? "-4rem" : 0, position: "relative" }}>
              {poster && (
                <div style={{ width: 100, height: 150, borderRadius: "0.5rem", overflow: "hidden", flexShrink: 0, border: "2px solid var(--border-strong)" }}>
                  <Image src={poster} alt={movie.title} width={100} height={150} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
                </div>
              )}
              <div style={{ flex: 1, paddingTop: poster && backdropUrl ? "2rem" : 0 }}>
                <h2 style={{ fontSize: "1.4rem", fontWeight: 800, lineHeight: 1.2, marginBottom: "0.25rem" }}>
                  {movie.title}
                </h2>
                <p style={{ color: "var(--text-2)", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                  {[year, runtime, movie.genres.slice(0, 3).map(g => g.name).join(" · ")].filter(Boolean).join(" · ")}
                </p>
                {/* Critic / audience scores (TMDB always; IMDb/RT/Metacritic via OMDb) */}
                <RatingBadges
                  ratings={ratings}
                  tmdb={movie.vote_average}
                  imdbLink
                  style={{ marginBottom: "0.75rem" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <StarRating value={rating} onChange={handleRate} size="md" />
                  {rating === 0 && (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.35rem 0.9rem" }}
                      disabled={watchlisted}
                      onClick={handleWatchlist}
                    >
                      {watchlisted ? "✓ In Watchlist" : "+ Watchlist"}
                    </button>
                  )}
                  {rating > 0 && (
                    <span style={{ fontSize: "0.75rem", color: "var(--accent)", fontWeight: 600 }}>✓ Watched</span>
                  )}
                  {trailer && (
                    <a
                      href={`https://www.youtube.com/watch?v=${trailer.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.35rem 0.9rem", color: "var(--danger)", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                    >
                      ▶ Trailer
                    </a>
                  )}
                </div>
              </div>
            </div>

            {movie.tagline && (
              <p style={{ color: "var(--accent)", fontStyle: "italic", fontSize: "0.85rem", marginTop: "1rem" }}>
                &ldquo;{movie.tagline}&rdquo;
              </p>
            )}

            <p style={{ color: "#d4d4d8", fontSize: "0.875rem", lineHeight: 1.7, marginTop: "0.75rem" }}>
              {movie.overview}
            </p>

            {/* Streaming platforms */}
            {(streamingProviders.length > 0 || rentProviders.length > 0) && (
              <div style={{ marginTop: "1.25rem" }}>
                {streamingProviders.length > 0 && (
                  <div style={{ marginBottom: "0.75rem" }}>
                    <p style={{ color: "var(--text-2)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
                      Stream
                    </p>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {streamingProviders.map((p) => (
                        <ProviderBadge key={p.provider_id} provider={p} title={movie.title} fallback={providers?.link} />
                      ))}
                    </div>
                  </div>
                )}
                {rentProviders.length > 0 && (
                  <div>
                    <p style={{ color: "var(--text-2)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
                      Rent / Buy
                    </p>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      {rentProviders.slice(0, 6).map((p) => (
                        <ProviderBadge key={p.provider_id} provider={p} title={movie.title} fallback={providers?.link} />
                      ))}
                    </div>
                  </div>
                )}
                {providers?.link && (
                  <a
                    href={providers.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "0.7rem", color: "var(--text-3)", display: "inline-block", marginTop: "0.35rem" }}
                  >
                    via JustWatch →
                  </a>
                )}
              </div>
            )}

            {/* Cast */}
            {cast.length > 0 && (
              <div style={{ marginTop: "1.25rem" }}>
                <p style={{ color: "var(--text-2)", fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
                  Cast
                </p>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                  {cast.map((actor) => (
                    <div key={actor.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--surface-2)", borderRadius: "999px", padding: "0.25rem 0.75rem 0.25rem 0.25rem" }}>
                      {actor.profile_path ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w45${actor.profile_path}`}
                          alt={actor.name} width={28} height={28}
                          style={{ borderRadius: "50%", objectFit: "cover" }}
                        />
                      ) : (
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--border-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem" }}>
                          👤
                        </div>
                      )}
                      <div>
                        <p style={{ fontSize: "0.75rem", fontWeight: 600, lineHeight: 1.2 }}>{actor.name}</p>
                        <p style={{ fontSize: "0.65rem", color: "var(--text-2)", lineHeight: 1.2 }}>{actor.character}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <Toast message={toast} onDismiss={() => setToast("")} />
      </div>
    </div>
  );
}

function ProviderBadge(
  { provider, title, fallback }:
  { provider: { provider_id: number; provider_name: string; logo_path: string }; title: string; fallback?: string }
) {
  const href = providerLink(provider.provider_id, title, fallback);
  const logo = (
    <Image
      src={`https://image.tmdb.org/t/p/w45${provider.logo_path}`}
      alt={provider.provider_name}
      width={20} height={20}
      style={{ borderRadius: "4px", objectFit: "cover" }}
    />
  );

  if (!href) {
    return (
      <span className="provider-badge" title={provider.provider_name}>
        {logo}<span>{provider.provider_name}</span>
      </span>
    );
  }
  return (
    <a
      className="provider-badge"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${provider.provider_name}`}
    >
      {logo}<span>{provider.provider_name}</span>
      <span aria-hidden="true" style={{ color: "var(--text-3)", fontSize: "0.7rem" }}>↗</span>
    </a>
  );
}

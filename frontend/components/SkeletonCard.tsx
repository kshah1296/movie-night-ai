export function SkeletonCard() {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: "var(--space-4)", padding: "var(--space-4)" }}>
        <div className="skeleton" style={{ width: 100, height: 150, flexShrink: 0, borderRadius: "var(--radius-sm)" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem", paddingTop: "0.25rem" }}>
          <div className="skeleton" style={{ height: 18, width: "70%" }} />
          <div className="skeleton" style={{ height: 13, width: "40%" }} />
          <div className="skeleton" style={{ height: 12, width: "100%" }} />
          <div className="skeleton" style={{ height: 12, width: "85%" }} />
          <div className="skeleton" style={{ height: 12, width: "55%" }} />
        </div>
      </div>
    </div>
  );
}

/** Poster-forward skeleton — matches the Discover grid tiles. */
export function SkeletonPosterCard() {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      <div className="skeleton" style={{ width: "100%", aspectRatio: "2/3", borderRadius: 0 }} />
      <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
        <div className="skeleton" style={{ height: 14, width: "80%" }} />
        <div className="skeleton" style={{ height: 11, width: "50%" }} />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6, variant = "row" }: { count?: number; variant?: "row" | "poster" }) {
  const poster = variant === "poster";
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: poster
        ? "repeat(auto-fill, minmax(150px, 1fr))"
        : "repeat(auto-fill, minmax(min(320px, 100%), 1fr))",
      gap: poster ? "var(--space-4)" : "var(--space-5)",
    }}>
      {Array.from({ length: count }).map((_, i) =>
        poster ? <SkeletonPosterCard key={i} /> : <SkeletonCard key={i} />
      )}
    </div>
  );
}

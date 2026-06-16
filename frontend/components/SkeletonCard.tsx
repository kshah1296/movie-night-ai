export function SkeletonCard() {
  return (
    <div style={{ background: "#18181b", borderRadius: "0.75rem", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: "1rem", padding: "1rem" }}>
        <div className="skeleton" style={{ width: 100, height: 150, flexShrink: 0, borderRadius: "0.5rem" }} />
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

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))", gap: "1.25rem" }}>
      {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  );
}

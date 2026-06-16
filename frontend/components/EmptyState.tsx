"use client";

interface EmptyStateProps {
  emoji: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode; // action buttons row
}

/** Standard empty/error state: emoji, title, readable subtitle, centered actions.
 * Replaces the six hand-rolled variants across the app. */
export default function EmptyState({ emoji, title, subtitle, children }: EmptyStateProps) {
  return (
    <div style={{ textAlign: "center", padding: "4.5rem 1rem 3rem" }}>
      <p style={{ fontSize: "2.75rem", marginBottom: "0.85rem", lineHeight: 1 }} aria-hidden="true">
        {emoji}
      </p>
      <h2 style={{ fontSize: "1.35rem", fontWeight: 700, marginBottom: "0.4rem" }}>{title}</h2>
      {subtitle && (
        <p style={{ color: "var(--text-2)", fontSize: "0.9rem", maxWidth: "42ch", margin: "0 auto 1.5rem", lineHeight: 1.6 }}>
          {subtitle}
        </p>
      )}
      {children && (
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          {children}
        </div>
      )}
    </div>
  );
}

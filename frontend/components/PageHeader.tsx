"use client";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: string;        // small accent label next to the title, e.g. "✨ AI Picks"
  actions?: React.ReactNode; // right-aligned controls (wrap under the title on mobile)
  align?: "left" | "center"; // "center" for showcase pages like /share (no actions slot)
}

/** Standard page header: gradient h1 + quiet subtitle + actions slot.
 * One spacing value everywhere so pages stop drifting apart. */
export default function PageHeader({ title, subtitle, badge, actions, align = "left" }: PageHeaderProps) {
  const centered = align === "center";
  return (
    <div
      style={{
        display: "flex",
        alignItems: centered ? "center" : "flex-start",
        justifyContent: centered ? "center" : "space-between",
        flexDirection: centered ? "column" : "row",
        flexWrap: "wrap",
        textAlign: centered ? "center" : "left",
        gap: "0.75rem 1rem",
        marginBottom: "1.25rem",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.25rem", lineHeight: 1.15 }}>
          <span className="gradient-text">{title}</span>
          {badge && (
            <span
              style={{
                marginLeft: "0.75rem",
                fontSize: "0.85rem",
                fontWeight: 500,
                color: "var(--accent)",
                verticalAlign: "middle",
                whiteSpace: "nowrap",
              }}
            >
              {badge}
            </span>
          )}
        </h1>
        {subtitle && <p style={{ color: "var(--text-2)", fontSize: "0.9rem" }}>{subtitle}</p>}
      </div>
      {actions && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  );
}

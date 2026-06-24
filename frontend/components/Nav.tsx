"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Primary sections (text) vs. secondary tools (icons), so the bar stays uncluttered.
const links = [
  { href: "/", label: "For You" },
  { href: "/group", label: "Movie Night" },
  { href: "/search", label: "Discover" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/ratings", label: "My Ratings" },
];

const iconLinks = [
  { href: "/taste", label: "Taste DNA", icon: "🧬" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--nav-bg)",
        backdropFilter: "blur(12px)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        className="nav-inner"
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "0 1.5rem",
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link href="/" style={{ textDecoration: "none" }}>
          <span className="gradient-text" style={{ fontSize: "clamp(1rem, 4vw, 1.3rem)", fontWeight: 800 }}>
            🎬 Movie Night AI
          </span>
        </Link>

        <div className="nav-links" style={{ display: "flex", alignItems: "center", gap: "0.15rem" }}>
          {links.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className="nav-link"
                aria-current={active ? "page" : undefined}
                style={{
                  padding: "0.4rem 0.85rem",
                  fontSize: "clamp(0.75rem, 4vw, 0.875rem)",
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--text-1)" : "var(--text-2)",
                  textDecoration: "none",
                }}
              >
                {label}
              </Link>
            );
          })}

          <span aria-hidden="true" style={{ width: 1, height: 22, background: "var(--border)", margin: "0 0.35rem" }} />

          {iconLinks.map(({ href, label, icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className="nav-icon"
                title={label}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                style={{ color: active ? "var(--text-1)" : "var(--text-2)", background: active ? "var(--accent-soft)" : "transparent" }}
              >
                <span aria-hidden="true">{icon}</span>
              </Link>
            );
          })}

          <button
            className="nav-icon"
            aria-label="Search"
            title="Search (⌘K)"
            onClick={() => window.dispatchEvent(new Event("mn:open-command-palette"))}
            style={{ color: "var(--text-2)" }}
          >
            <span aria-hidden="true">🔍</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

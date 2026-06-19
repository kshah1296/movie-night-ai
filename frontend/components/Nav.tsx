"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "For You" },
  { href: "/search", label: "Discover" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/ratings", label: "My Ratings" },
  { href: "/taste", label: "Taste DNA" },
  { href: "/settings", label: "Settings" },
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

        <div className="nav-links" style={{ display: "flex", gap: "0.25rem" }}>
          {links.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className="nav-link"
                aria-current={active ? "page" : undefined}
                style={{
                  padding: "0.4rem 0.9rem",
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
          <button
            className="nav-link"
            aria-label="Search (Command-K)"
            title="Search — ⌘K"
            onClick={() => window.dispatchEvent(new Event("mn:open-command-palette"))}
            style={{
              padding: "0.4rem 0.7rem", background: "none", border: "none", cursor: "pointer",
              color: "var(--text-2)", fontSize: "clamp(0.75rem, 4vw, 0.875rem)",
              display: "flex", alignItems: "center", gap: "0.3rem",
            }}
          >
            <span aria-hidden="true">🔍</span>
            <kbd style={{
              fontSize: "0.65rem", padding: "0.05rem 0.3rem", borderRadius: 4,
              border: "1px solid var(--border-strong)", color: "var(--text-3)",
            }}>⌘K</kbd>
          </button>
        </div>
      </div>
    </nav>
  );
}

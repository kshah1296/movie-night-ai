"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "For You" },
  { href: "/search", label: "Discover" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/ratings", label: "My Ratings" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        borderBottom: "1px solid var(--border)",
        background: "rgba(9,9,11,0.8)",
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
        </div>
      </div>
    </nav>
  );
}

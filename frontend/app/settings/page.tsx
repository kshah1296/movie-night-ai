"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getDismissed, undoRecFeedback, type DismissedItem,
} from "@/lib/api";
import { STREAMING_PROVIDERS, loadServices, saveServices } from "@/lib/streaming";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { useToast } from "@/components/ToastProvider";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="gradient-border" style={{ padding: "1.5rem 1.4rem", borderRadius: "var(--radius-lg)", marginBottom: "2rem" }}>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const [services, setServices] = useState<number[]>([]);
  const [dismissed, setDismissed] = useState<DismissedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const push = useToast();
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    // localStorage is client-only, so these must read after mount (hydration-safe).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(getTheme());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setServices(loadServices());
    getDismissed()
      .then(setDismissed)
      .catch(() => push("Couldn't load your dismissed movies."))
      .finally(() => setLoading(false));
  }, []);

  function toggleService(id: number) {
    setServices((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveServices(next);
      return next;
    });
  }

  async function restore(item: DismissedItem) {
    const prev = dismissed;
    setDismissed((d) => d.filter((x) => x.tmdb_id !== item.tmdb_id)); // optimistic
    push(`Restored "${item.title ?? "movie"}" — it can appear in For You again.`);
    try {
      await undoRecFeedback(item.tmdb_id);
    } catch {
      setDismissed(prev); // revert
      push("Couldn't restore that one — try again.");
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1.5rem 4rem" }}>
      <PageHeader title="Settings" subtitle="Your streaming services and recommendation preferences" />

      {/* UX8 — appearance */}
      <Card>
        <h3 style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: "0.4rem" }}>
          Appearance
        </h3>
        <p style={{ color: "var(--text-2)", fontSize: "0.85rem", marginBottom: "1rem", lineHeight: 1.5 }}>
          Choose how Movie Night AI looks. Your choice is remembered on this device.
        </p>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["dark", "light"] as Theme[]).map((t) => (
            <button
              key={t}
              className={`tab${theme === t ? " tab-active" : ""}`}
              aria-pressed={theme === t}
              onClick={() => { setThemeState(t); setTheme(t); }}
            >
              {t === "dark" ? "🌙 Dark" : "☀️ Light"}
            </button>
          ))}
        </div>
      </Card>

      {/* UX4 — default streaming services (shared by For You + Watchlist filters) */}
      <Card>
        <h3 style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: "0.4rem" }}>
          My streaming services
        </h3>
        <p style={{ color: "var(--text-2)", fontSize: "0.85rem", marginBottom: "1rem", lineHeight: 1.5 }}>
          Pick what you subscribe to. The “📺 On my services” filters on For You and your Watchlist use this set.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {STREAMING_PROVIDERS.map((p) => {
            const on = services.includes(p.id);
            return (
              <button
                key={p.id}
                className={`chip${on ? " chip-active" : ""}`}
                aria-pressed={on}
                onClick={() => toggleService(p.id)}
              >
                {on ? "✓ " : ""}{p.label}
              </button>
            );
          })}
        </div>
        {services.length === 0 && (
          <p style={{ color: "var(--gold)", fontSize: "0.75rem", marginTop: "0.75rem" }}>
            None selected — the streaming filters stay off until you pick at least one.
          </p>
        )}
      </Card>

      {/* UX5 — "Not interested" management + decay note */}
      <Card>
        <h3 style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: "0.4rem" }}>
          Not interested ({dismissed.length})
        </h3>
        <p style={{ color: "var(--text-2)", fontSize: "0.85rem", marginBottom: "1rem", lineHeight: 1.5 }}>
          Movies you’ve dismissed from For You. They’re hidden for ~90 days, then can resurface on their own.
          Restore one to let it back in immediately.
        </p>

        {loading ? (
          <p style={{ color: "var(--text-3)", fontSize: "0.85rem" }}>Loading…</p>
        ) : dismissed.length === 0 ? (
          <EmptyState emoji="✨" title="Nothing dismissed"
            subtitle="When you tap ✕ on a For You card, it shows up here so you can undo it later.">
            <Link href="/" className="btn-secondary">Go to For You</Link>
          </EmptyState>
        ) : (
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {dismissed.map((item) => (
              <li key={item.tmdb_id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem",
                padding: "0.6rem 0.8rem", background: "var(--surface-2)",
                border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              }}>
                <span style={{ fontSize: "0.9rem", color: "var(--text-1)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.title ?? `Movie #${item.tmdb_id}`}
                </span>
                <button className="btn-secondary btn-sm" onClick={() => restore(item)} style={{ flexShrink: 0 }}>
                  ↩ Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

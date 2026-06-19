"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchMovies, searchPeople, type TmdbMovie, type PersonResult } from "@/lib/api";

// UX1 — global ⌘K / Ctrl-K command palette: search any movie or person and jump straight
// to it on Discover. Mounted once in the layout; manages its own open state + keyboard nav.

type Item =
  | { kind: "movie"; id: number; label: string; sub: string }
  | { kind: "person"; id: number; label: string; sub: string };

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  const close = useCallback(() => { setOpen(false); setQuery(""); setItems([]); setActive(0); }, []);

  // Global hotkey: ⌘K / Ctrl-K toggles; Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        close();
      }
    }
    function onOpenEvent() { setOpen(true); }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mn:open-command-palette", onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mn:open-command-palette", onOpenEvent);
    };
  }, [open, close]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 20); }, [open]);

  // Debounced search across movies + people.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setItems([]); return; }
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const [movies, people] = await Promise.all([
          searchMovies(q).then((r) => r.results).catch(() => [] as TmdbMovie[]),
          searchPeople(q).catch(() => [] as PersonResult[]),
        ]);
        if (id !== reqId.current) return; // a newer query won
        const merged: Item[] = [
          ...people.slice(0, 3).map((p): Item => ({
            kind: "person", id: p.id, label: p.name,
            sub: p.known_for_department || "Person",
          })),
          ...movies.slice(0, 7).map((m): Item => ({
            kind: "movie", id: m.id, label: m.title,
            sub: m.release_date ? m.release_date.slice(0, 4) : "Movie",
          })),
        ];
        setItems(merged);
        setActive(0);
      } catch { /* ignore */ }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  function go(item: Item) {
    if (item.kind === "person") {
      router.push(`/search?person=${item.id}&personName=${encodeURIComponent(item.label)}`);
    } else {
      router.push(`/search?q=${encodeURIComponent(item.label)}`);
    }
    close();
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && items[active]) { e.preventDefault(); go(items[active]); }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search movies and people"
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "center",
        alignItems: "flex-start", paddingTop: "12vh",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)",
        animation: "modal-backdrop-in 0.15s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 92vw)", background: "var(--surface)",
          border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)", overflow: "hidden",
          animation: "modal-pop 0.18s ease-out",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Search any movie or person…"
          aria-label="Search query"
          style={{
            width: "100%", padding: "1rem 1.1rem", border: "none", outline: "none",
            background: "transparent", color: "var(--text-1)", fontSize: "1rem",
            borderBottom: items.length ? "1px solid var(--border)" : "none",
          }}
        />
        {items.length > 0 && (
          <ul style={{ listStyle: "none", maxHeight: "50vh", overflowY: "auto", padding: "0.35rem" }}>
            {items.map((item, i) => (
              <li key={`${item.kind}-${item.id}`}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item)}
                  style={{
                    width: "100%", textAlign: "left", display: "flex", alignItems: "center",
                    gap: "0.65rem", padding: "0.55rem 0.7rem", borderRadius: "var(--radius-sm)",
                    border: "none", cursor: "pointer",
                    background: i === active ? "var(--surface-3)" : "transparent",
                    color: "var(--text-1)",
                  }}
                >
                  <span aria-hidden="true">{item.kind === "person" ? "🎭" : "🎬"}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.label}
                  </span>
                  <span style={{ color: "var(--text-3)", fontSize: "0.75rem", flexShrink: 0 }}>{item.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{
          padding: "0.5rem 0.85rem", borderTop: "1px solid var(--border)",
          color: "var(--text-3)", fontSize: "0.7rem", display: "flex", gap: "1rem",
        }}>
          <span>↑↓ to navigate</span><span>↵ to open</span><span>esc to close</span>
        </div>
      </div>
    </div>
  );
}

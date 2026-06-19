"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// UX7 — global, stacking toast queue. Each toast has its own timer + Undo, so several recent
// actions are independently undoable (previously only the most-recent action could be undone).
// Provider is mounted once in the layout; any component calls `useToast()` to push.

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}
interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}
type PushFn = (message: string, opts?: ToastOptions) => number;

const ToastContext = createContext<PushFn>(() => 0);
export function useToast(): PushFn {
  return useContext(ToastContext);
}

const MAX_VISIBLE = 4; // cap the stack so a burst of actions can't bury the screen

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<PushFn>((message, opts) => {
    const id = ++idRef.current;
    setItems((prev) => [...prev, { id, message, ...opts }].slice(-MAX_VISIBLE));
    return id;
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {items.length > 0 && (
        <div
          aria-live="polite"
          style={{
            position: "fixed", bottom: "2rem", left: "50%", transform: "translateX(-50%)",
            display: "flex", flexDirection: "column-reverse", gap: "0.5rem",
            zIndex: 9999, alignItems: "center", pointerEvents: "none", maxWidth: "92vw",
          }}
        >
          {items.map((item) => <ToastRow key={item.id} item={item} onRemove={remove} />)}
        </div>
      )}
    </ToastContext.Provider>
  );
}

function ToastRow({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const duration = item.duration ?? 3000;

  // Auto-dismiss; pauses while hovered/focused so slower & AT users can reach Undo.
  useEffect(() => {
    if (paused) return;
    setLeaving(false);
    const leaveTimer = setTimeout(() => setLeaving(true), Math.max(duration - 300, 0));
    const killTimer = setTimeout(() => onRemove(item.id), duration);
    return () => { clearTimeout(leaveTimer); clearTimeout(killTimer); };
  }, [paused, duration, item.id, onRemove]);

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{
        background: "var(--gradient-2)", color: "var(--text-on-accent)",
        padding: "0.6rem 1rem 0.6rem 1.5rem", borderRadius: "999px", fontWeight: 600,
        fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "0.75rem",
        pointerEvents: "auto", maxWidth: "92vw", boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        animation: leaving ? "toast-slide-down 0.3s ease-in forwards" : "toast-slide-up 0.2s ease-out",
      }}
    >
      <span>{item.message}</span>
      {item.actionLabel && item.onAction && (
        <button
          onClick={() => { item.onAction?.(); onRemove(item.id); }}
          style={{
            background: "rgba(255,255,255,0.25)", border: "none", borderRadius: "999px",
            color: "white", fontWeight: 700, fontSize: "0.8rem", padding: "0.3rem 0.85rem",
            minHeight: 32, cursor: "pointer",
          }}
        >
          {item.actionLabel}
        </button>
      )}
    </div>
  );
}

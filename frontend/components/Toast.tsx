"use client";

import { useEffect, useState } from "react";

interface Props {
  message: string;
  onDismiss: () => void;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
  id?: number; // bump on every showToast so identical messages restart the timer (P2-16)
}

export default function Toast({ message, onDismiss, duration = 3000, actionLabel, onAction, id }: Props) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);

  // Reset transient state whenever a new toast arrives (keyed on message OR id).
  useEffect(() => {
    if (!message) return;
    setLeaving(false);
    setPaused(false);
  }, [message, id]);

  // Auto-dismiss timer. Pauses while hovered/focused so slower & AT users can reach Undo (P3-9).
  useEffect(() => {
    if (!message || paused) return;
    setLeaving(false);
    const leaveTimer = setTimeout(() => setLeaving(true), Math.max(duration - 300, 0));
    const dismissTimer = setTimeout(onDismiss, duration);
    return () => { clearTimeout(leaveTimer); clearTimeout(dismissTimer); };
  }, [message, id, duration, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      style={{
        position: "fixed",
        bottom: "2rem",
        left: "50%",
        transform: "translateX(-50%)",
        background: "linear-gradient(135deg, #a855f7, #ec4899)",
        color: "white",
        padding: "0.6rem 1rem 0.6rem 1.5rem",
        borderRadius: "999px",
        fontWeight: 600,
        zIndex: 9999,
        fontSize: "0.875rem",
        animation: leaving
          ? "toast-slide-down 0.3s ease-in forwards"
          : "toast-slide-up 0.2s ease-out",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        pointerEvents: actionLabel ? "auto" : "none",
        maxWidth: "90vw",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <span>{message}</span>
      {actionLabel && onAction && (
        <button
          onClick={() => { onAction(); onDismiss(); }}
          style={{
            background: "rgba(255,255,255,0.25)",
            border: "none",
            borderRadius: "999px",
            color: "white",
            fontWeight: 700,
            fontSize: "0.8rem",
            padding: "0.3rem 0.85rem",
            minHeight: 32,
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

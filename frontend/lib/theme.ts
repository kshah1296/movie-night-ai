"use client";

// UX8 — light/dark theme. CSS only overrides tokens under [data-theme="light"]; dark is the
// default (no attribute). Persisted in localStorage; applied pre-paint by a script in the layout.
export type Theme = "dark" | "light";
const KEY = "mn-theme";

export function getTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

export function applyTheme(t: Theme): void {
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
}

export function setTheme(t: Theme): void {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  applyTheme(t);
}

// Inline, blocking script string — runs before first paint to avoid a theme flash.
export const THEME_INIT_SCRIPT =
  "(function(){try{if(localStorage.getItem('mn-theme')==='light')" +
  "document.documentElement.setAttribute('data-theme','light');}catch(e){}})();";

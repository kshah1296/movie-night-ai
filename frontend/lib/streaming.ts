// Streaming-service preferences, persisted in localStorage. Single source of truth for the
// US TMDB watch-provider list — also imported by the Discover page (audit M3).

export const STREAMING_PROVIDERS = [
  { id: 8, label: "Netflix" },
  { id: 9, label: "Prime Video" },
  { id: 337, label: "Disney+" },
  { id: 15, label: "Hulu" },
  { id: 1899, label: "Max" },
  { id: 350, label: "Apple TV+" },
  { id: 531, label: "Paramount+" },
  { id: 386, label: "Peacock" },
];

const SERVICES_KEY = "movieNightServices";
const TOGGLE_KEY = "movieNightStreamingOnly";

export function loadServices(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SERVICES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

export function saveServices(ids: number[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SERVICES_KEY, JSON.stringify(ids));
}

export function loadStreamingOnly(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TOGGLE_KEY) === "1";
}

export function saveStreamingOnly(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOGGLE_KEY, on ? "1" : "0");
}

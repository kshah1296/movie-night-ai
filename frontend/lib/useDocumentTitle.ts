"use client";

import { useEffect } from "react";

/** Sets the browser tab/history title for a (client-component) page. UX10.
 * Pages are client components so they can't export Next `metadata`; this is the
 * framework-agnostic equivalent. Pass the page label; the suffix is added here. */
export function useDocumentTitle(label: string): void {
  useEffect(() => {
    const prev = document.title;
    document.title = label ? `${label} · Movie Night AI` : "Movie Night AI";
    return () => { document.title = prev; };
  }, [label]);
}

"use client";

import { useEffect } from "react";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";

// Route-level error boundary (QA-EB). Catches render/runtime errors in any page segment so a
// single bad state shows a recovery UI instead of a white screen. Rendered inside the root layout.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface the error for local debugging (and any future telemetry hook).
    console.error("Route error:", error);
  }, [error]);

  return (
    <EmptyState
      emoji="🫠"
      title="Something went wrong"
      subtitle="That page hit a snag. You can try again, or head back to your picks."
    >
      <button className="btn-primary" onClick={reset}>↻ Try again</button>
      <Link href="/" className="btn-secondary">Back to For You</Link>
    </EmptyState>
  );
}

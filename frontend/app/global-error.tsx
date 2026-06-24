"use client";

// Root-layout error boundary (QA-EB). This replaces the entire document when the root layout
// itself throws, so it renders its own <html>/<body> and uses self-contained inline styles
// (design tokens from globals.css may not be available at this point).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: "100vh", background: "#09090b", color: "#fafafa",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui, -apple-system, sans-serif", textAlign: "center", padding: "2rem",
      }}>
        <div>
          <p style={{ fontSize: "2.75rem", marginBottom: "0.85rem" }} aria-hidden="true">🫠</p>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.4rem" }}>The app hit a snag</h1>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", maxWidth: "40ch", margin: "0 auto 1.5rem", lineHeight: 1.6 }}>
            Something unexpected happened while loading. Reloading usually fixes it.
          </p>
          <button
            onClick={reset}
            style={{
              background: "linear-gradient(135deg, #a855f7, #ec4899)", color: "#fff", border: "none",
              borderRadius: 999, padding: "0.6rem 1.5rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer",
            }}
          >
            ↻ Reload
          </button>
        </div>
      </body>
    </html>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTasteProfile, type TasteProfile, type TasteAxis } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

// ── Radar geometry: 10 spokes. Bipolar mapping r = (value+1)/2 → center is the
// negative pole, the outer edge is the positive pole, the mid-ring is neutral. ──
const R = 118;
const CX = 150;
const CY = 150;

function pointFor(value: number, i: number, n: number, radius = R): [number, number] {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const r = ((Math.max(-1, Math.min(1, value)) + 1) / 2) * radius;
  return [CX + r * Math.cos(angle), CY + r * Math.sin(angle)];
}

function TasteRadar({ axes, meanConfidence }: { axes: TasteAxis[]; meanConfidence: number }) {
  const n = axes.length;
  const valuePts = axes.map((a, i) => pointFor(a.value, i, n));
  const polygon = valuePts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const fillOpacity = 0.12 + 0.28 * meanConfidence; // surer profile → more solid shape

  return (
    <svg viewBox="0 0 300 300" width="100%" style={{ maxWidth: 360, display: "block", margin: "0 auto" }} role="img"
      aria-label="Radar chart of your taste across ten axes">
      {/* concentric grid rings; the neutral mid-ring (0.5) is emphasized */}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <circle key={f} cx={CX} cy={CY} r={R * f} fill="none"
          stroke={f === 0.5 ? "var(--border-strong)" : "var(--border)"}
          strokeWidth={f === 0.5 ? 1.2 : 1} strokeDasharray={f === 0.5 ? "3 3" : undefined} />
      ))}
      {/* spokes + axis labels */}
      {axes.map((a, i) => {
        const [ex, ey] = pointFor(1, i, n);
        const [lx, ly] = pointFor(1.32, i, n);
        const anchor = lx > CX + 4 ? "start" : lx < CX - 4 ? "end" : "middle";
        return (
          <g key={a.axis}>
            <line x1={CX} y1={CY} x2={ex} y2={ey} stroke="var(--border)" strokeWidth={1} />
            <text x={lx} y={ly} fontSize="9.5" fontWeight={600} textAnchor={anchor}
              dominantBaseline="middle" fill="var(--text-2)" style={{ textTransform: "capitalize" }}>
              {a.lean === "balanced" ? a.axis : a.lean}
            </text>
          </g>
        );
      })}
      {/* the taste shape */}
      <polygon points={polygon} fill="var(--accent)" fillOpacity={fillOpacity}
        stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
      {/* vertices sized by per-axis confidence */}
      {valuePts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.8 + 3 * axes[i].confidence} fill="var(--accent)" />
      ))}
    </svg>
  );
}

function DivergingBar({ a }: { a: TasteAxis }) {
  const pct = ((a.value + 1) / 2) * 100; // 0 = neg pole, 100 = pos pole
  const lean = a.value >= 0;
  return (
    <div style={{ marginBottom: "0.85rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem",
        color: "var(--text-3)", marginBottom: 3 }}>
        <span style={{ fontWeight: a.value < -0.08 ? 700 : 400, color: a.value < -0.08 ? "var(--text-1)" : "var(--text-3)" }}>{a.neg}</span>
        <span style={{ fontWeight: a.value > 0.08 ? 700 : 400, color: a.value > 0.08 ? "var(--text-1)" : "var(--text-3)" }}>{a.pos}</span>
      </div>
      <div style={{ position: "relative", height: 8, background: "var(--surface-3)",
        borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
        {/* center neutral tick */}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--border-strong)" }} />
        {/* fill from center toward the leaning pole; opacity = confidence */}
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: lean ? "50%" : `${pct}%`, width: `${Math.abs(pct - 50)}%`,
          background: "var(--accent)", opacity: 0.35 + 0.65 * a.confidence,
        }} />
      </div>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
      {items.map((t) => (
        <span key={t} className="chip" style={{ textTransform: "capitalize", cursor: "default" }}>{t}</span>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3 style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: "0.6rem" }}>{title}</h3>
      {children}
    </div>
  );
}

export default function TastePage() {
  const [data, setData] = useState<TasteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getTasteProfile()
      .then(setData)
      .catch(() => setError("Could not load your taste profile. Is the backend running?"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem 4rem" }}>
      <PageHeader
        title="Your Taste DNA"
        badge="🧬 10 axes"
        subtitle={data?.has_profile
          ? `Learned from ${data.n_ratings} ratings · ${Math.round((data.mean_confidence) * 100)}% confidence`
          : "What the engine has learned about how you like your movies"}
      />

      {loading && (
        <div style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--text-3)" }}>
          <span className="spinner" aria-hidden="true" /> <span className="sr-only">Loading taste profile</span>
        </div>
      )}

      {!loading && error && (
        <EmptyState emoji="⚠️" title="Couldn't load your taste" subtitle={error}>
          <Link href="/" className="btn-secondary">Back to For You</Link>
        </EmptyState>
      )}

      {!loading && !error && data && !data.has_profile && (
        <EmptyState emoji="🧬" title="Your Taste DNA is still forming"
          subtitle="Rate a few movies you've seen, then open For You once — your 10-axis taste profile shows up here.">
          <Link href="/search" className="btn-primary">Rate some movies</Link>
          <Link href="/" className="btn-secondary">Go to For You</Link>
        </EmptyState>
      )}

      {!loading && !error && data?.has_profile && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: "2rem", alignItems: "start" }} className="taste-grid">
            {/* Left: the radar showcase */}
            <div className="gradient-border" style={{ padding: "1.5rem 1.25rem", borderRadius: "var(--radius-lg)" }}>
              <TasteRadar axes={data.axes} meanConfidence={data.mean_confidence} />
              {data.traits.length > 0 && (
                <p style={{ textAlign: "center", marginTop: "1rem", color: "var(--text-2)", fontSize: "0.9rem" }}>
                  You gravitate toward{" "}
                  <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{data.traits.slice(0, 3).join(", ")}</span> films.
                </p>
              )}
              <p style={{ textAlign: "center", marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--text-3)" }}>
                Dot size = how confident the engine is on that axis · the dashed ring is neutral.
              </p>
            </div>

            {/* Right: the precise per-axis breakdown */}
            <div className="gradient-border" style={{ padding: "1.5rem 1.4rem", borderRadius: "var(--radius-lg)" }}>
              <h3 style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase",
                letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: "1rem" }}>The 10 axes</h3>
              {data.axes.map((a) => <DivergingBar key={a.axis} a={a} />)}
            </div>
          </div>

          {/* What shapes the picks */}
          <div style={{ marginTop: "2rem", display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.5rem 2rem" }}>
            {data.genres.length > 0 && (
              <Section title="Top genres"><Chips items={data.genres.map((g) => g.name)} /></Section>
            )}
            {data.people.length > 0 && (
              <Section title="People you follow"><Chips items={data.people.map((p) => p.name)} /></Section>
            )}
            {data.keywords.length > 0 && (
              <Section title="Themes you return to"><Chips items={data.keywords} /></Section>
            )}
          </div>

          <p style={{ marginTop: "2rem", fontSize: "0.78rem", color: "var(--text-3)", textAlign: "center" }}>
            This updates as you rate more — each visit to <Link href="/" style={{ color: "var(--accent)" }}>For You</Link> refines it.
          </p>
        </>
      )}
    </div>
  );
}

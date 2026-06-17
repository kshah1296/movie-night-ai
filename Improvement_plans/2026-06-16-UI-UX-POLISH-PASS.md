# UI/UX Polish Pass — Movie Night AI

**Date:** 2026-06-16
**Author:** Staff Product Designer / Frontend pass
**Status:** ✅ Implemented 2026-06-16 — all 6 phases shipped (Phase 6 poster-forward Discover
approved by user). `npx tsc --noEmit` clean; no new lint errors (7 pre-existing remain).
**Builds on:** `UI-UX-REDESIGN.md`, `QA-FINDINGS.md` (these established the token system, shared
components, and accessibility baseline — this doc is the *next* layer, not a redo)

---

## 0. TL;DR

The app is already functional, accessible, and on a token system. It is **not** broken — so this is a
polish pass, not a teardown. The gap between where it is now and "best-in-class SaaS" (Linear, Stripe,
Vercel) is four things:

1. **The token system exists but is bypassed everywhere.** ~90% of styling is inline hardcoded hex
   (`#a1a1aa`, `#18181b`, `#27272a`) instead of `var(--text-2)` / `var(--surface)`. Tokens can't enforce
   consistency if nothing references them.
2. **No typographic or spacing scale.** 16+ ad-hoc font sizes, margins ranging 0.6–1.5rem chosen
   per-element. Nothing snaps to a grid, so everything is *slightly* off from everything else.
3. **Gradient is over-applied.** It's on the logo, every page title, every primary button, every active
   chip, the toast, the watched badge, and the ambient glow. When the accent is everywhere, nothing reads
   as premium. The best products spend their accent budget carefully.
4. **No elevation/depth system.** Cards are flat at rest; the only shadow in the app is on the toast.

Fixing these four — without changing a single user flow — is what moves it from "indie project" to
"production SaaS."

---

## 1. Audit — what's already strong (keep, don't touch)

| Area | Current state | Verdict |
|------|---------------|---------|
| Design tokens | `:root` defines `--bg/surface/text-1..3/accent/danger/gold/gradient` | ✅ Good foundation, just underused |
| Shared components | `PageHeader`, `EmptyState`, `Toast`, `MovieCard`, `StarRating`, `SkeletonCard` | ✅ Right abstractions exist |
| Accessibility | Focus trap (`MovieModal`), `aria-hidden` on background, `prefers-reduced-motion`, 44px coarse-pointer targets, `aria-pressed`/`aria-current`, `role="status"` toasts, `.sr-only` | ✅ Genuinely above-average |
| Optimistic UI | Snapshot → update → revert-on-catch on every mutation | ✅ Keep the pattern |
| URL-as-state | Discover encodes all filters to the querystring (shareable) | ✅ Keep |
| Loading | Skeleton grids + modal skeleton | ✅ Keep |

**The implication:** almost every change below is *refactor toward the system you already have*, not
"invent something new." Low risk to functionality.

---

## 2. Top UX/visual issues (prioritized)

### P0 — System integrity (root cause of everything else)

- **0.1 — Inline hex bypasses tokens.** `MovieCard.tsx:99` uses `#a1a1aa`, `:103` `#e4e4e7`, posters
  `#27272a`; `MovieModal`, `watchlist`, `ratings`, `share` all repeat the same literals. Drift is
  guaranteed. → Replace literals with `var(--*)`; add the missing tokens (see §3).
- **0.2 — `share/page.tsx` uses `#71717a` for body text** (lines 47, 59, 104). The whole reason
  `--text-3` was set to `#8b8b96` (per the comment in `globals.css:14`) was to clear a 5:1 contrast
  floor — share regressed below it. → Swap to `var(--text-3)`. *(Accessibility bug, not just style.)*
- **0.3 — No type scale.** Sizes seen in code: 0.65 / 0.7 / 0.72 / 0.75 / 0.78 / 0.8 / 0.85 / 0.875 /
  0.9 / 0.95 / 1 / 1.1 / 1.2 / 1.35 / 1.4 / 2rem. → Collapse to a 7-step ramp (§3).
- **0.4 — No spacing scale.** Section margins are picked by feel (`0.6`, `0.75`, `0.85`, `1`, `1.25`,
  `1.5`). → 4px-based scale; stack rhythm becomes predictable.

### P1 — Visual hierarchy & polish

- **1.1 — Gradient overuse.** `PageHeader.tsx:30` forces `.gradient-text` on *every* page title.
  Recommend: solid `--text-1` titles, reserve the gradient for the logo + the single primary CTA per
  view. (See the "one accent budget" note in `UI-UX-REDESIGN.md` — this finishes that thought.)
- **1.2 — Flat cards, no depth.** `.gradient-border` only animates on hover; at rest cards are a flat
  fill indistinguishable from the page. → Add a resting elevation token (subtle shadow + 1px border) and
  a stronger hover elevation. Gives the grid physical structure.
- **1.3 — Button sizing via inline overrides.** Every "small" button re-declares
  `fontSize:0.75rem; padding:0.3rem 0.75rem` (MovieCard `:125`, watchlist `:308`, modal `:235`). →
  Add `.btn-sm` modifier + a real `.btn-icon` for the close/dismiss circles.
- **1.4 — Three hand-duplicated "media card" layouts.** The poster-100×150 + body block is copy-pasted
  in `MovieCard`, `watchlist/page.tsx:252`, and `ratings/page.tsx:85`. → Extract the poster+frame into a
  `<Poster>` primitive; consider routing watchlist/ratings cards through `MovieCard` or a shared shell.

### P2 — Cognitive load & flow

- **2.1 — For You control stack is heavy.** Up to 5 rows before the first movie: fallback note → taste
  strip → mood pills + genre chips → streaming toggle → service chips (`page.tsx:377–452`). → Group into
  one "controls" band; collapse streaming services behind the toggle (already conditional, but visually
  merge it with the mode bar). Keep the taste strip — it's a differentiator — but make it quieter.
- **2.2 — Inconsistent error surface.** `search/page.tsx:615` and `watchlist/page.tsx:182` render raw red
  text; everywhere else uses `<EmptyState>`. → Route all errors through `EmptyState` for one error
  language.
- **2.3 — Discover is text-heavy where it should be poster-forward.** Discover cards lead with the
  overview paragraph (secondary info) at thumbnail poster size. For browsing, the *poster* is the
  decision driver. → Offer a poster-forward grid variant for Discover (denser, more per row), keep the
  explanation card for For You where the AI reason *is* the value. **Product call — flag for sign-off.**

### P3 — Mobile & responsive

- **3.1 — Cards are wide on desktop, sparse columns.** `minmax(min(320px,100%),1fr)` → max 3 columns in
  the 1100px container. A poster-forward Discover (2.3) naturally fixes density.
- **3.2 — Nav wraps but doesn't restructure** on mobile (`globals.css:296`). Acceptable; low priority.

---

## 3. Redesign strategy — the design language

### 3a. Color (extend, don't replace)
Keep the existing palette; add the missing semantic tokens and *use* them:

```css
/* add to :root */
--surface-3:   #2e2e35;   /* hover fill for surfaces */
--text-on-accent: #ffffff;
--shadow-sm:  0 1px 2px rgba(0,0,0,0.4);
--shadow-md:  0 4px 16px rgba(0,0,0,0.35);
--shadow-lg:  0 12px 32px rgba(0,0,0,0.45);
--radius-sm: 0.5rem;  --radius-md: 0.75rem;  --radius-lg: 1rem;
```
**Accent budget rule:** gradient = logo + one primary CTA per screen + active nav underline. Everything
else uses solid `--accent` or neutral surfaces. Active chips can stay gradient (they're the selection
signal) but page titles go solid.

### 3b. Typography scale
```css
--font-xs: 0.75rem;   /* meta, captions */
--font-sm: 0.8125rem; /* secondary body */
--font-md: 0.875rem;  /* base body */
--font-lg: 1rem;      /* emphasized body / inputs */
--font-xl: 1.25rem;   /* section headings */
--font-2xl: 1.5rem;   /* card/modal titles */
--font-3xl: 2rem;     /* page titles */
```
Line-heights: 1.2 headings, 1.5 body, 1.6 long-form (modal overview). Replace the 16 ad-hoc sizes.

### 3c. Spacing scale (4px base)
`--space-1:0.25rem … --space-2:0.5 … --space-3:0.75 … --space-4:1 … --space-5:1.25 … --space-6:1.5 …
--space-8:2rem`. Grid gap = `--space-5`; standard section rhythm = `--space-4`; page-header bottom =
`--space-5`. One rhythm everywhere.

### 3d. Elevation
- Card at rest: `--surface` fill + `1px solid --border` + `--shadow-sm`.
- Card hover: lift `translateY(-2px)` + `--shadow-md` + the existing gradient-border glow.
- Modal: `--shadow-lg`. Toast keeps its shadow.

---

## 4. Implementation plan (phased, low-risk first)

> Each phase is independently shippable and preserves all functionality. Order is chosen so the
> highest-leverage / lowest-risk work lands first.

**Phase 1 — Tokenize (mechanical, zero visual change intended).**
Add new tokens to `globals.css`. Replace inline hex literals with `var(--*)` across all pages/components.
Fix the `share` `#71717a` contrast regression (0.2). Net visual diff ≈ 0; net consistency gain = large.
*Verify with `npx tsc --noEmit` + visual diff each page.*

**Phase 2 — Type + spacing scale.**
Introduce the ramps (§3b/c); migrate font-size/margin literals. This is where pages stop looking
*slightly* misaligned.

**Phase 3 — Buttons & elevation.**
Add `.btn-sm`, `.btn-icon`; remove inline size overrides. Add resting card elevation. Standardize the
dismiss/close circles on `.btn-icon`.

**Phase 4 — Component dedupe.**
Extract `<Poster>` primitive (poster + frame + vote badge + watched badge). Route watchlist/ratings
cards through it. Removes ~3 copies of the same JSX.

**Phase 5 — Hierarchy pass.**
Solid page titles (gradient → `--text-1` + small accent badge stays). Consolidate For You control stack
(2.1). Route all errors through `EmptyState` (2.2).

**Phase 6 — Discover poster-forward variant (needs sign-off).**
Add a poster-led card mode for Discover; denser grid. Keep For You's explanation card. **Do not start
until the product call in 2.3 is approved** — it's the only change that alters layout meaningfully.

---

## 5. Future opportunities (out of scope here, worth tracking)

- **Command-palette search** (⌘K) for power users — jump to a movie/person from anywhere.
- **Keyboard nav on the card grid** (arrow keys + Enter to open) — currently mouse/tap only.
- **"Why this pick" expansion** on For You cards — the AI `anchor` is shown; let users expand the full
  reasoning inline.
- **Skeleton → content crossfade** instead of hard swap.
- **Light theme** — the token system makes this cheap once everything references `var(--*)`.
- **Empty-watchlist → For You bridge:** suggest adding top picks straight from the empty state.
- **Settings page** for default streaming services (currently only set inline on For You).

---

## 6. Guardrails (do not regress)

- Keep every accessibility win from `QA-FINDINGS.md` (focus trap, reduced-motion, 44px targets,
  `aria-*`, `role="status"`).
- Python-3.9 / Next 16 backend & data contracts are untouched — this is frontend-presentation only.
- Never run `next build` while `npm run dev` is live (shared `.next/`).
- No functional/flow changes in Phases 1–5; Phase 6 is the only layout change and is gated on sign-off.
```

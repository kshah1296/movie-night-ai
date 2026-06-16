# Movie Night AI — UI/UX Redesign Audit & Implementation Plan

> Staff-level design pass over the whole frontend (June 2026). Goal: move the interface from
> "good side project" to "polished product" — the standard set by Linear, Vercel, and Stripe —
> **without changing any functionality**. Everything in Parts 1–3 is research; Part 4 is the
> implementation contract; Part 5 lists future opportunities deliberately left out of this pass.

---

## Part 1: Audit — what exists today

Files reviewed: `app/layout.tsx`, `app/page.tsx` (For You), `app/roulette/page.tsx`,
`app/search/page.tsx` (Discover), `app/watchlist/page.tsx`, `app/ratings/page.tsx`,
`app/share/page.tsx`, `components/{Nav,MovieCard,MovieModal,StarRating,Toast,SkeletonCard}.tsx`,
`app/globals.css`.

### What's already strong (keep, don't churn)
- **Coherent dark-zinc identity**: `#09090b` bg, `#18181b` surfaces, one signature gradient
  (`#a855f7 → #ec4899 → #f97316`). This is a real brand; the redesign amplifies it, not replaces it.
- **Optimistic UI everywhere** with snapshot/revert — interactions feel instant.
- **Undo patterns** (watchlist remove, not-interested) — destructive actions are forgiving.
- **Entrance animations** (`.card-in` stagger), skeleton shimmer, modal pop — motion language exists.
- **URL-as-state on Discover** — filters are shareable and survive refresh. Genuinely Linear-grade.

### Page-by-page issues

**For You (`app/page.tsx`)**
1. **Control overload above the fold.** Header + subtitle + taste strip (up to 13 pills) +
   mode bar (4 mood tabs + 12 genre chips + clear) + streaming row (toggle + 8 chips) =
   **38+ interactive/visual elements before the first movie**. First-time users see a wall of
   controls for content they haven't seen yet.
2. **Initial load is a centered spinner** while every other page shows skeleton cards — layout
   jumps when content arrives, and it's inconsistent.
3. Genre chips wrap to 2–3 rows on mobile, pushing content further down.
4. Subtitle is instructional noise ("tap ↻ for a fresh set") rather than value.

**Discover (`app/search/page.tsx`)**
5. Search input has no search icon and **no clear (✕) button** — emptying a query requires
   selecting text and deleting. The single most common correction action is unsupported.
6. Filter chips inside the drawer have no `aria-pressed`; screen readers announce them as plain
   buttons with no state.

**Watchlist (`app/watchlist/page.tsx`)**
7. **Every card has a gradient `btn-primary` ("Mark Watched")** — 12 screaming primaries per
   screen. When everything is primary, nothing is. Stripe/Linear rule: one primary action per view.
8. "Remove" is a `btn-secondary` with red text bolted on — an ad-hoc danger pattern repeated
   (differently) on the Ratings page.

**Ratings (`app/ratings/page.tsx`)**
9. Same ad-hoc red Remove button. Also the star row + Remove button double up: clicking the
   current star already removes (the subtitle even says so), so Remove is redundant — but it
   stays for discoverability; it just shouldn't *compete* visually.

**Nav (`components/Nav.tsx`)**
10. Active state is a flat `#27272a` pill — the one place the brand gradient is *absent* is the
    "you are here" indicator. No `aria-current`. Five links + logo wrap awkwardly at ~520px.

**Cross-cutting**
11. **Contrast failures (WCAG 1.4.3):** `#71717a` on `#09090b` ≈ 4.1:1 — borderline at small
    sizes; `#52525b` (Roulette footer) ≈ 2.7:1 — fails outright. Tertiary text needs a floor.
12. **No `prefers-reduced-motion` support** — shimmer, pulse, spin, stagger all run for
    vestibular-sensitive users. One media query fixes the whole app.
13. **Toasts aren't announced** — no `role="status"`/`aria-live`, so screen readers miss every
    confirmation ("Rated 5★", "Removed…", "Undo").
14. **Page headers are hand-rolled five times** with drifting margins (0.75/1.5/2rem) and
    subtitle styles. Same for empty states (different emoji sizes, paddings, CTA styles).
15. **Touch targets:** chips are ~26px tall; iOS HIG floor is 44px, practical dark-UI floor ~32px.
16. **Modal loading state** is the bare string "Loading…" — the only data fetch in the app
    without a skeleton.
17. Hardcoded hex values everywhere (`#a1a1aa` ×40, `#27272a` ×30…) — no tokens, so any future
    palette change is a 7-file grep.

### Heuristic scorecard (Nielsen, pre-redesign)

| Heuristic | Grade | Worst offender |
|---|---|---|
| Visibility of system status | B+ | Toasts invisible to AT (13) |
| Match with real world | A | — |
| User control & freedom | A− | No search clear (5) |
| Consistency & standards | C+ | Headers/empties/danger buttons hand-rolled (8, 9, 14) |
| Error prevention | A− | — |
| Recognition over recall | B | Control wall hides the content (1) |
| Flexibility & efficiency | B+ | — |
| Aesthetic & minimalist design | B− | 38 elements pre-content (1), 12 primaries (7) |
| Accessibility | C | 11, 12, 13, 15 |

---

## Part 2: Redesign strategy

Three principles drive every change:

1. **Content first, controls second.** A movie app should lead with movies. Controls get one
   visual tier quieter, one row shorter, and the first paint shows movie-shaped skeletons.
2. **One primary per view.** The gradient is reserved for *the* action (Refresh on For You,
   Spin on Roulette, the empty-state CTA). Everything else is secondary/ghost. Danger gets its
   own quiet ghost pattern, used identically everywhere.
3. **Systematize the 80%.** PageHeader, EmptyState, and CSS tokens replace the five hand-rolled
   copies of each. Not a component library — just the three patterns that repeat.

**What is deliberately NOT changing:** layout grid (the 320px card grid works), the card design
(recently rebuilt, good), the filter drawer architecture, the modal layout, any API call, any
state management, any route.

---

## Part 3: Design system decisions

### Tokens (`:root` CSS variables)
```
--bg #09090b | --surface #18181b | --surface-2 #27272a | --border #27272a
--border-strong #3f3f46 | --text-1 #fafafa | --text-2 #a1a1aa | --text-3 #8b8b96
--accent #a855f7 | --danger #f87171 | --gold #fbbf24
```
`--text-3` is a **new value** (#8b8b96, ≈5.2:1 on bg) replacing both #71717a and #52525b in
running text. #71717a survives only for decorative/duplicated-information text.
New CSS *uses* tokens; existing inline hexes are migrated opportunistically, not exhaustively.

### Component patterns
- **`PageHeader`** (`components/PageHeader.tsx`): gradient `<h1>`, optional badge slot,
  `--text-2` subtitle, right-aligned `actions` slot that wraps under on mobile. One spacing
  value (1.25rem bottom).
- **`EmptyState`** (`components/EmptyState.tsx`): emoji (2.75rem), title, subtitle (max-width
  42ch), centered actions row. Replaces 6 hand-rolled empties.
- **`.btn-ghost-danger`**: transparent, `--text-3` → `--danger` on hover, subtle danger border
  on hover. The *only* way Remove actions render from now on.
- **`.chip` enlarged**: 0.3rem 0.8rem padding, min-height 30px (mobile media query bumps to 34px).
- **`.chip-row`**: single-line horizontal scroll container with hidden scrollbar + edge fade
  mask — kills the 3-row chip wrap on For You mobile.
- **Nav active**: gradient text + 2px gradient underline instead of the gray pill;
  `aria-current="page"`.

### Accessibility contract
- `role="status" aria-live="polite"` on Toast.
- `aria-pressed` on every toggle-style chip/tab (genres, moods, services, filters, status tabs).
- `@media (prefers-reduced-motion: reduce)` disables all animation/transition globally.
- Tertiary text floor `--text-3`; Roulette footer and hint texts bumped.
- Modal gets a skeleton body instead of "Loading…" text.

---

## Part 4: Implementation tasks (this pass)

| # | Task | Files |
|---|------|-------|
| 1 | Tokens, `.btn-ghost-danger`, `.chip-row`, chip sizing, nav underline, reduced-motion, scrollbar polish | `globals.css` |
| 2 | `PageHeader` + `EmptyState` components | new files |
| 3 | Nav: gradient active underline, `aria-current`, tighter mobile | `Nav.tsx` |
| 4 | Toast: `role="status"`, `aria-live` | `Toast.tsx` |
| 5 | For You: PageHeader w/ Refresh action, skeleton first paint, single-row scrollable genre chips, quieter taste strip, `aria-pressed`, EmptyState | `page.tsx` |
| 6 | Watchlist: PageHeader, Mark Watched → secondary, Remove → ghost-danger, EmptyState, `aria-pressed` | `watchlist/page.tsx` |
| 7 | Ratings: PageHeader, Remove → ghost-danger, EmptyState | `ratings/page.tsx` |
| 8 | Discover: PageHeader, search field with icon + clear ✕, `aria-pressed` on all filter chips, EmptyState | `search/page.tsx` |
| 9 | Modal: skeleton loading body; MovieCard: aria-label on watchlist button, 2-line title clamp | `MovieModal.tsx`, `MovieCard.tsx` |
| 10 | Share: contrast bump, PageHeader reuse | `share/page.tsx` |
| 11 | Verify: `npx tsc --noEmit` + `npm run build` | — |

---

## Part 5: Future opportunities (not in this pass)

- **Command palette (⌘K)** for search/navigation — the Linear move; needs a portal + key handler.
- **Poster-grid view toggle** on Discover (dense grid like the Share page vs. detail cards).
- **Focus trap** in the modal (currently Esc + initial focus only); a `focus-trap` util without
  deps is ~30 lines.
- **Skeleton → content crossfade** instead of swap.
- **Per-page `<title>`** via Next metadata for history/tabs.
- **Container queries** for card internals when next/Safari support settles.
- **Light theme** — tokens now make it a ~20-line addition.

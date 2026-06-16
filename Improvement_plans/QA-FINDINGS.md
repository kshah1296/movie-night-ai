> **RESOLUTION STATUS (updated after the fix pass):** Most findings are now fixed in code —
> see the **Resolution log** at the bottom of this doc for the per-ID status and the short list of
> consciously deferred items (product/data decisions). `tsc --noEmit` + `npm run build` pass clean.

# Movie Night AI — QA Findings (User-Simulation Pass)

> Three QA testers walked the app as distinct real-user personas (June 2026), reading the live
> frontend + backend and reasoning through actual sessions. This doc consolidates all findings for
> a developer agent to work through. Each finding has a stable ID, severity, exact location
> (`file:line`), what happens, why it's bad, and a concrete fix.
>
> **Personas:**
> - **P1 — Maya, first-time user** (zero ratings, non-technical): onboarding, empty states, clarity, dead ends.
> - **P2 — Dev, power user** (~30 ratings, daily use): core loops, state correctness, broken/surprising flows, bugs.
> - **P3 — Sam, mobile + accessibility** (375px, keyboard, screen reader, reduce-motion): responsive, touch targets, a11y.
>
> **Verification note:** The compiler spot-checked the highest-stakes bug claims against source.
> Corrections are flagged inline (see **P2-11**, which was found largely invalid). All other findings
> were left as reported; a developer should still confirm repro before large changes.

## Severity legend
- **Critical** — data loss, broken core flow, or total blocker.
- **High** — frequent real-world friction, misleading state, or excludes a user group.
- **Medium** — noticeable problem in a common path; should fix.
- **Low** — polish, edge case, or cosmetic.

---

## Executive triage — start here

Ranked by impact ÷ effort. These cluster the 44 raw findings into the work that matters most.
Cross-persona overlaps are merged with references to the full findings below.

### Tier 1 — genuine bugs / data loss (fix first)
| Theme | Findings | One-line |
|---|---|---|
| **Toast/Undo clobbering loses data** | P2-5, P2-4, P3-9, P2-16 | A single `toast`/`removed` slot per page means rapid dismiss/remove orphans all but the last Undo; fast Undo also races the feedback POST. Destructive actions silently become irreversible. |
| **StarRating click-to-clear is broken on desktop** | P2-9, P1-14 | `hovered === 0` gate + volatile `key={star-value}` remount means clicking the lit star re-saves instead of clearing (works only on touch). Confirmed in `StarRating.tsx:30,33`. |
| **Rating silently force-marks "Watched"** | P1-5, P1-6 | Rating a movie on a card also adds-to-watchlist-and-marks-watched with no warning and no card-level undo; the button becomes a disabled dead end. |
| **Modal has no focus trap** | P3-3 | `aria-modal` is set but focus escapes behind the dialog; background not `inert`. |

### Tier 2 — misleading state / discoverability (high value)
| Theme | Findings | One-line |
|---|---|---|
| **For You never loads existing ratings/watchlist** | P2-7, P2-8 | The landing page seeds its state only from on-page actions, so card badges ("+ Watchlist", stars) are wrong vs. ground truth, especially on 5-min cache hits. |
| **No real first-run onboarding** | P1-1, P1-2, P1-3, P1-12, P1-13 | Default page (For You) can't function without ratings, shows fake skeletons then a bare empty state, and empty states link to other empty states in a loop. |
| **`/share` is orphaned** | P1-7 | Built feature, never linked from nav or Watchlist — unreachable except by typing the URL. |
| **AI badge lies on quota fallback** | P2-1, P1-10 | When Groq is over quota, picks silently degrade to templated reasons under a quieter badge; the "✨ AI Picks" vs "Similar to your ratings" split confuses without informing. |
| **Permanent, un-auditable "Not interested"** | P2-15 | Hard-excludes forever with no decay and no management UI (API exists, no page); miss the 5s Undo and the movie is gone for good. |

### Tier 3 — mobile & a11y hardening
| Theme | Findings | One-line |
|---|---|---|
| **Touch targets < 44px everywhere** | P3-1, P3-2, P3-4, P3-12 | Chips 34px, tabs 38px, dismiss-✕ 24px, stars ~26px, nav links tight; the destructive ✕ overlaps the card-open action. |
| **Star rating SR semantics** | P3-4, P3-13 | No `radiogroup`/`aria-checked`, current value not announced, watched ✓ badge unlabeled. |
| **Decorative emoji read aloud** | P3-6 | Inconsistent `aria-hidden`; SR reads "television my services only", "clapper board Movie Night AI". |
| **Contrast + reduce-motion gaps** | P3-8, P3-11, P3-5 | Lingering `#71717a` (<4.5:1), frozen spinner under reduce-motion, hidden-scroll chip row hides off-screen genres. |

### Tier 4 — polish
P1-4, P1-8, P1-9, P1-11, P2-2, P2-3, P2-6, P2-10, P2-12, P2-13, P2-14, P3-7, P3-10, P3-14.

> **Recommended order:** Tier 1 (bugs) → P2-7/P2-8 + onboarding (P1-1) + `/share` link (P1-7) → a11y touch targets & focus trap (P3-1/P3-2/P3-3/P3-4) → remaining Tier 2/3 → polish.

---

## P1 — Maya, first-time user

### [P1-1] First-ever visit shows skeleton cards then a bare empty state — no onboarding
- **Severity:** High
- **Location:** `app/page.tsx:184-233`
- **What happens:** Lands on `/` with no ratings → sees 8 shimmering skeleton cards (`SkeletonGrid count={8}`), which then vanish into a single centered "Rate some movies to get started" + a button. No welcome, no explanation of what the app does, no how-it-works.
- **Why it's bad:** Skeletons make a false "content is loading" promise that immediately breaks — a bait-and-switch on the first impression. Zero orientation on the value prop or the rate-first workflow. The most important page is the emptiest for a new user.
- **Suggested fix:** Detect the zero-ratings/zero-watchlist first-run state and render a dedicated welcome panel instead of skeletons-then-empty: one line on what the app does, a 1-2-3 (Rate → Get picks → Build a watchlist), single primary CTA to Discover. Skip the skeleton grid entirely when there are no ratings.

### [P1-2] Chicken-and-egg never explained in the empty state
- **Severity:** Medium
- **Location:** `app/page.tsx:208-233` (empty branch returns before the mode bar at 294-349)
- **What happens:** Empty state hides all controls (correct) but never says *why* there's nothing or that recs come *from her ratings*. Subtitle hints but doesn't state the hard requirement (zero ratings = zero recs).
- **Why it's bad:** The payoff page requires prior work the user wasn't told about; "Get started" implies the page itself acts.
- **Suggested fix:** Explicit causal copy: "Your AI picks are built from movies you rate. Rate 3-5 films you've seen and they'll appear here." Keep the single Discover CTA.

### [P1-3] Default landing page is the one page that can't function for a new user
- **Severity:** High
- **Location:** `components/Nav.tsx:7`, `app/page.tsx`
- **What happens:** `/` = For You (inert without ratings); the productive page (Discover) is tab 2. New users land on a dead end.
- **Why it's bad:** IA front-loads the payoff page before the input page.
- **Suggested fix:** Keep `/` as For You but render the P1-1 onboarding panel funneling to Discover; make that CTA the single unmissable action.

### [P1-4] Rating from a card isn't discoverable — gray stars look decorative
- **Severity:** High
- **Location:** `components/MovieCard.tsx:115-116`, `components/StarRating.tsx:28-45`
- **What happens:** Only rating affordance on a card is a row of small gray stars with no "Rate this" label. Gray stars read as a *displayed average*, not an input.
- **Why it's bad:** The core action the app depends on is unlabeled and visually ambiguous.
- **Suggested fix:** Add a tiny "Rate it:" / "Seen it? Rate:" label above card stars (at least on Discover); consider an outlined empty star so it reads as actionable.

### [P1-5] Rating silently force-marks a movie "Watched" with no warning
- **Severity:** High
- **Location:** `app/search/page.tsx:377-381`, `app/page.tsx:127-129`, `components/MovieCard.tsx:121-131`
- **What happens:** Clicking stars calls `rateAndAddWatched` → sets rating AND adds to watchlist AND marks watched; "+ Watchlist" flips to a disabled "✓ Watched"; toast says "Added to Watched".
- **Why it's bad:** A first-timer rating to *train recs* doesn't expect the movie filed as "already watched"; the rating==watched assumption is never communicated and pollutes Watched + the rec exclusion set.
- **Suggested fix:** Decouple rate from mark-watched, or surface the coupling (label stars "Rate (movies you've seen)") and make the watched state reversible from the card.

### [P1-6] "+ Watchlist" becomes a disabled dead-end after rating
- **Severity:** Medium
- **Location:** `components/MovieCard.tsx:118-132`
- **What happens:** Once rated/watchlisted the button is `disabled` ("✓ Watchlist"/"✓ Watched") with no in-card way to reverse. Reads as broken to a non-technical user.
- **Why it's bad:** Disabled controls with no explanation are an anti-pattern; no way to undo an accidental click without leaving the page.
- **Suggested fix:** Make the confirmed state an active toggle or a non-disabled affordance that opens the modal where state can change.

### [P1-7] `/share` is completely orphaned — no nav link anywhere
- **Severity:** Medium
- **Location:** `app/share/page.tsx` exists; `components/Nav.tsx:6-11` has no entry; grep confirms no `/share` link anywhere
- **What happens:** The shareable watchlist is reachable only by typing the URL. No "Share" button on the Watchlist page either.
- **Why it's bad:** A whole feature (whose point is sharing) is invisible.
- **Suggested fix:** Add a "Share this list" action on the Watchlist page (link to `/share` and/or copy URL). Probably not a top-level tab, but must be reachable from Watchlist.

### [P1-8] "Your taste" pills mix raw keywords + a cryptic 🎬 person prefix, and look clickable
- **Severity:** Low
- **Location:** `app/page.tsx:282-292`
- **What happens:** A "YOUR TASTE" row shows static pills mixing genres, people (🎬 prefix), and raw lowercase TMDB keywords ("neo-noir", "found family"), visually identical to the clickable chips right below — but they do nothing.
- **Why it's bad:** Non-interactive pills that look interactive invite dead clicks; the 🎬 person prefix is cryptic; no legend.
- **Suggested fix:** Caption it ("What we've learned — not clickable"), visually distinguish from the interactive chips, and label the person prefix ("Dir:"/"Cast:").

### [P1-9] "Because you loved X" overclaims from a single low rating
- **Severity:** Low
- **Location:** `app/page.tsx:370`, `components/MovieCard.tsx:78-92`
- **What happens:** Cards show "BECAUSE YOU LOVED [TITLE]" even when the anchor was rated 3★ (merely liked).
- **Why it's bad:** Overclaiming "loved" from low-confidence data undermines trust exactly when it's being established.
- **Suggested fix:** Scale language to the rating ("Because you rated X 5★" / "Based on your taste for X"); reserve "loved" for 4-5★ anchors.

### [P1-10] Source badge ("✨ AI Picks" vs "Similar to your ratings") is opaque and slightly worrying
- **Severity:** Low
- **Location:** `app/page.tsx:235-239`
- **What happens:** Two labels describe the same thing to a new user; the distinction (LLM-ranked vs TMDB-fallback) is meaningless and reads as "wait, are these *not* AI?". See also P2-1.
- **Why it's bad:** Exposes an internal implementation detail as user copy, creating doubt without actionable info.
- **Suggested fix:** Show one neutral, confident label ("Your picks" / "✨ For You"); keep `source` for telemetry only.

### [P1-11] Empty-ratings microcopy is duplicated across backend + frontend and can drift
- **Severity:** Low
- **Location:** backend `recommendations.py` (`source:"none"` + message), `app/page.tsx:209-217`
- **What happens:** For zero ratings the backend returns `source:"none"` so the frontend shows its own title using the backend `message` when present; two different strings can drift, and the subtitle is always the frontend's.
- **Why it's bad:** Drift-prone microcopy; unclear ownership of the most important empty state.
- **Suggested fix:** One source of truth (frontend, since it also needs P1-1 onboarding); backend just signals state via `source`.

### [P1-12] Empty states link to other empty states in a loop
- **Severity:** Medium
- **Location:** `app/page.tsx:208`, `app/watchlist/page.tsx:192`, `app/ratings/page.tsx:64`, `app/search/page.tsx`
- **What happens:** Watchlist's empty state offers "See AI Picks" → lands on the empty For You page — a circular dead end for a newcomer.
- **Why it's bad:** Empty→empty loops are frustrating; Watchlist actively sends users to a page with nothing for them.
- **Suggested fix:** For zero-rating users, every empty state's primary CTA points to Discover; suppress "See AI Picks" until ratings exist.

### [P1-13] Discover (the onboarding destination) is optimized for browsing, not "rate films I've seen"
- **Severity:** Low
- **Location:** `app/search/page.tsx:31-65, 439-442`
- **What happens:** Opens on Trending with filter machinery (decades, rating thresholds, runtime, providers); none of it oriented toward "find a movie I've already watched to rate it".
- **Why it's bad:** The funnel destination doesn't match the funnel's goal.
- **Suggested fix:** When arriving from a zero-state CTA, show a one-line nudge ("Search for a few movies you've already seen and rate them — that's what powers your picks").

### [P1-14] Star-clear gesture ("click the lit star again") is undiscoverable (and see P2-9: also broken on desktop)
- **Severity:** Low
- **Location:** `components/StarRating.tsx:33,37`
- **What happens:** Clicking the selected star clears to 0, surfaced only via `aria-label` — invisible to a sighted mouse user; a mis-click "fix" wipes the rating.
- **Why it's bad:** Hidden gesture with a destructive outcome; compounded by P1-5 (clear has side effects).
- **Suggested fix:** Add a visible "Clear" ✕ next to the stars when a rating is set rather than overloading a second click; see P2-9 for the desktop reliability bug.

---

## P2 — Dev, power user

### [P2-1] "✨ AI Picks" badge lies when Groq quota is exhausted
- **Severity:** High
- **Location:** `app/page.tsx:235-239`; backend `recommendations.py` fallback path (`source="tmdb"`, `_template_reason`)
- **Repro / what happens:** Over the 100K-token/day quota, `_groq_rank_v2` throws → engine falls back to `source="tmdb"` with templated explanations, but the kicker ("Because you loved X") still renders. Badge quietly changes to "Similar to your ratings"; no explicit "AI unavailable" signal.
- **Why it's bad:** A daily user silently gets lower-quality templated picks dressed as personalized, with only a badge-text change he won't notice. Erodes trust.
- **Suggested fix:** When `source==="tmdb"`, show an inline note ("AI is resting — these are taste-matched by similarity") and/or have the backend return a distinct `message` on the quota-fallback path.

### [P2-2] Refresh churn quickly recycles the same titles; no "pool exhausted" state
- **Severity:** Medium
- **Location:** `app/page.tsx:97-101`, `recommendations.py` (`seed`, `page = (seed % 3) + 1`, Groq `seed=`)
- **Repro / what happens:** Seed varies per refresh, but candidate pages only cycle TMDB pages 1-3, and Groq's `seed` param makes ranking *more* reproducible — so 5-10 refreshes surface heavily overlapping sets with no acknowledgment.
- **Why it's bad:** Refresh feels stale fast for a heavy user.
- **Suggested fix:** Widen the page window (e.g. `page = (seed % 8) + 1`); when the post-exclude pool shrinks below N, return a `message` ("You've seen most of your matches — rate more to refresh the pool").

### [P2-3] Mode switch doesn't reset `refreshCount`; 5-min cache can mask just-made rating changes
- **Severity:** Medium
- **Location:** `app/page.tsx:85-101`; backend cache key `fp|refresh|genre|mood|providers`
- **Repro / what happens:** `pickGenre`/`pickMood` fetch with `refresh=0` but never reset `refreshCount`, so the next Refresh jumps to a stale seed. Switching genre A→B→A within 5 min returns the cached A payload — correct, but the "Your taste" strip/badge were computed at cache time. (Note: `fp_base` includes ratings, so a rating change does bust it — verify the staleness window is acceptable.)
- **Why it's bad:** Mode-switching results don't obviously correspond to the active mode's freshness.
- **Suggested fix:** Reset `refreshCount` to 0 in `pickGenre`/`pickMood`/`toggleStreaming`.

### [P2-4] Fast Undo on "Not interested" races the feedback POST → Undo silently overwritten
- **Severity:** High
- **Location:** `app/page.tsx:159-175`
- **Repro / what happens:** `handleNotInterested` optimistically removes the card then `await sendRecFeedback`. Clicking Undo before the POST resolves fires the DELETE first (404, swallowed by `.catch(()=>{})`), then the POST lands and persists `not_interested` anyway. UI shows restored; backend has it excluded; movie vanishes on next Refresh.
- **Why it's bad:** Dismiss-fast-then-Undo is exactly what a power user does; Undo *looks* successful but the DB disagrees.
- **Suggested fix:** Sequence ops — if Undo fires while POST is pending, chain DELETE after the POST settles; make DELETE idempotent and retry on 404; stop swallowing the error.

### [P2-5] One `toast`/`removed` slot per page → rapid actions orphan all but the last Undo
- **Severity:** High
- **Location:** `app/page.tsx:50-51,80-83,159-175`; `app/watchlist/page.tsx:29-30,67-101`
- **Repro / what happens:** Dismiss A (Undo→A), then dismiss B before expiry → `showToast` overwrites action to B; A is now gone and un-undoable. Same on Watchlist: remove A then B fast → `removed` holds only B; A unrecoverable.
- **Why it's bad:** Power users batch these; every action but the last loses Undo silently — destructive ops become irreversible without warning.
- **Suggested fix:** Queue toasts (array of `{message, action, id}`) preserving each action, or finalize the prior undo target immediately when a new one arrives; track removed items in a stack keyed by id.

### [P2-6] Watchlist Undo loses list position and desyncs the Rating row
- **Severity:** Medium
- **Location:** `app/watchlist/page.tsx:80-101`; backend `watchlist.py`
- **Repro / what happens:** `handleUndo` re-POSTs (prepends to top, `added_at` resets) then PUTs `watched:true` if needed — but the separate Rating row (created earlier by `rateAndAddWatched`) isn't part of remove/undo, so watched+rated items come back with inconsistent rating-source state and a lost position.
- **Why it's bad:** Undo is advertised as a true revert; silent reordering + rating desync make state subtly wrong.
- **Suggested fix:** Snapshot and restore the original index; make backend remove/undo symmetric (delete+restore the Rating, or document independence).

### [P2-7] For You never loads existing ratings/watchlist → card badges are wrong
- **Severity:** Medium
- **Location:** `app/page.tsx` (no mount fetch of ratings/watchlist); contrast with `search/page.tsx:273-294`
- **Repro / what happens:** For You's `ratings`/`watchlisted` maps start empty and only fill from on-page actions. On a 5-min cache hit a movie rated elsewhere can appear with 0 stars and an enabled "+ Watchlist". (Backend usually excludes rated movies, but cached payloads predate the change.)
- **Why it's bad:** Cross-page rating yields inconsistent star/watchlist state; "+ Watchlist" offers to add something already watched.
- **Suggested fix:** Have `app/page.tsx` fetch `getRatings()`/`getWatchlist()` on mount to seed its maps (like Discover). Longer term, a shared store/context.

### [P2-8] For You "+ Watchlist" disabled state derived from maps it never server-seeds
- **Severity:** Medium
- **Location:** `app/page.tsx:373-379`, `components/MovieCard.tsx:121-132`
- **Repro / what happens:** Card disables on `isWatched || inWatchlist || rating > 0`, but For You's maps start empty (P2-7), so an already-watchlisted rec shows enabled "+ Watchlist"; clicking re-POSTs (idempotent, no dupe) but the label lied and the toast falsely says "Added".
- **Why it's bad:** Misleading affordance + false confirmation for a cross-page user.
- **Suggested fix:** Same as P2-7 — seed maps on mount.

### [P2-9] StarRating "click lit star to clear" is unreliable on desktop (CONFIRMED)
- **Severity:** Medium
- **Location:** `components/StarRating.tsx:30,33` (verified)
- **Repro / what happens:** Clear is `star === value && hovered === 0 ? 0 : star`. On desktop, hovering the star sets `hovered = star` (nonzero), so clicking the lit star writes `star` again (no-op re-save + "rated N★" toast + network write) instead of clearing. `key={`${star}-${value}`}` also remounts buttons on every value change, resetting hover mid-interaction. On touch (`hovered` always 0) it *does* clear — desktop/touch inconsistency.
- **Why it's bad:** Clearing a rating is unreliable for a user managing ~30 ratings; produces phantom re-saves.
- **Suggested fix:** Drop the `hovered === 0` condition (clear whenever the clicked star equals committed `value`); use a stable `key={star}` so hover isn't destroyed on rating change. See also P1-14 (add a visible Clear ✕).

### [P2-10] Discover: changing a filter mid-infinite-scroll can desync page accounting
- **Severity:** Medium
- **Location:** `app/search/page.tsx:334-353, 296-331`
- **Repro / what happens:** `loadMore` closes over `page`/`totalPages` at observer-creation time. Flipping a filter resets `page=1` and `fetchKeyRef`, but a fast second scroll before page-1-of-the-new-query resolves can call `loadMore` with the new key but stale `totalPages`, fetching page 2 before page 1 lands. `dedupeAppend` hides visible dupes but ordering/`page` count can desync and produce a wrong terminal "Load More" state.
- **Why it's bad:** Heavy filter-flipping while scrolling (core Discover behavior) yields missing/out-of-order results.
- **Suggested fix:** Cancel/guard in-flight `loadMore` on key change; recompute `page`/`totalPages` only from the resolved current-key fetch; verify the `loading` gate blocks during the page-1 refetch.

### [P2-11] "Highest Rated" sort — REPORTED as returning junk; INVESTIGATED & LARGELY INVALID
- **Severity:** Low (downgraded from Medium)
- **Location:** frontend `app/search/page.tsx:163-178` (`toDiscoverParams`), backend `movies.py:86-91` (verified)
- **Finding status:** The original claim was that `vote_average.desc` lacks a vote-count floor and returns obscure 2-vote 10.0 films. **This is incorrect** — the backend `discover` endpoint already injects `params.setdefault("vote_count.gte", 300)` for `sort_by == "vote_average.desc"` (`movies.py:87-88`). Highest Rated does **not** return junk.
- **Residual (minor):** The floor lives only in the backend; the frontend `toDiscoverParams` is unaware. If any client path ever calls TMDB without the backend proxy, the floor would be missing. Purely defensive.
- **Suggested fix:** None required. Optional: document the backend floor in `toDiscoverParams` as a comment so future devs don't re-add it client-side or assume it's missing.

### [P2-12] Modal-close doesn't refresh the For You grid (inconsistent with Watchlist)
- **Severity:** Low
- **Location:** `app/page.tsx:251-263` vs `app/watchlist/page.tsx:124-140`
- **Repro / what happens:** Watchlist re-fetches on modal close; For You's `onClose` is just `setModalId(null)`. For You also has no `watched` map (passes `isWatched={false}` hardcoded), so a movie rated in the modal shows "✓ Watched" only because `rating > 0`; the "Not interested" ✕ stays, and dismissing a now-watched movie sends confusing feedback.
- **Why it's bad:** Minor state drift; works by coincidence of `rating>0` overlap; inconsistent with Watchlist.
- **Suggested fix:** Standardize modal-close behavior across pages; mirror all modal state changes into parent maps (or re-fetch).

### [P2-13] Streaming toggle ON with zero services silently shows everything while looking active
- **Severity:** Low
- **Location:** `app/page.tsx:78,103-115,344-348`; backend `recommendations.py` providers handling
- **Repro / what happens:** `activeProviders = streamingOnly && services.length ? services : undefined`. Toggle ON + no services → request identical to OFF, but the pill stays `tab-active` (looks like it's filtering). Reload restores ON with `[]` services → same lit-but-no-op.
- **Why it's bad:** User trusts that shown movies are on their services when they aren't.
- **Suggested fix:** When ON but `services.length === 0`, render the pill in a "needs services" warning state (or auto-emphasize the service chips); don't show active-and-working.

### [P2-14] Over-filtered empty state needs two clicks to fully reset (mode + streaming)
- **Severity:** Low
- **Location:** `app/page.tsx:85-89, 222-224, 318-322`
- **Repro / what happens:** `pickGenre(null)` clears mode but keeps streaming on; if the empty result was mode + streaming, "Show all picks" clears mode but may still be empty, requiring a second click on "Turn off streaming filter".
- **Why it's bad:** Friction recovering from over-filtering.
- **Suggested fix:** Add a single "Reset all filters" action that clears mode AND streaming together. (Also a maintenance note: `pickGenre(null)` clears both genre and mood — rename/comment to avoid future confusion.)

### [P2-15] "Not interested" is a permanent hard-exclude with no review/restore UI
- **Severity:** Medium
- **Location:** backend `recommendations.py` (exclude set), `rec_feedback.py` (`GET`/`DELETE` exist, unused by UI)
- **Repro / what happens:** Every `not_interested` id is permanently excluded (no decay, unlike `shown`). The only undo is the 5s toast. Dismiss 50 movies over weeks → silently shrunk rec pool, no audit/restore.
- **Why it's bad:** Irreversible accumulation; rec pool quietly degrades with no recovery.
- **Suggested fix:** Add a "Not interested" management view (the API already exists) listing dismissed titles with restore; and/or decay `not_interested` after N months.

### [P2-16] Toast `useEffect` keyed only on `message` → repeated identical messages don't restart the timer
- **Severity:** Low
- **Location:** `components/Toast.tsx:16-22`
- **Repro / what happens:** Dep array is `[message]`. Two actions with the same string don't re-run the effect (timer keeps running from the first), so the second toast can vanish almost instantly; `duration`/`onAction` changes also aren't picked up, so a repeated message that should gain an Undo won't.
- **Why it's bad:** Edge-case flicker/early dismiss; the Undo affordance can fail to appear.
- **Suggested fix:** Key the toast on a monotonic id bumped on every `showToast`; include `duration` in deps.

---

## P3 — Sam, mobile + accessibility

### [P3-1] Touch targets below 44px across all interactive controls
- **Severity:** High
- **Location:** `globals.css` `.chip` (`min-height:34px` coarse), `.tab` (38px), `.dismiss-x` (24px), `.search-clear` (26px); `MovieModal.tsx:124` close (36px)
- **What happens:** Largest target is the 36px modal close; the ✕ buttons are 24-26px — at/under the WCAG 2.5.8 floor with no spacing buffer, all under HIG 44 / Material 48.
- **Why it's bad:** Mis-taps for one-handed/motor-impaired users; a near-miss on the dismiss-✕ triggers the card click instead. WCAG 2.5.8 (AA), 2.5.5 (AAA).
- **Suggested fix:** `@media (pointer:coarse)` → `.chip`/`.tab` `min-height:44px`; make `.dismiss-x`/`.search-clear` 44×44px hit area (keep visual circle small via inner span); modal close → 44px.

### [P3-2] "Not interested" ✕ overlaps the card-open target and is hard to hit on touch
- **Severity:** High
- **Location:** `components/MovieCard.tsx:41-50`; `globals.css` `@media (hover:none){.dismiss-x{opacity:1}}`
- **What happens:** The ✕ is correctly visible on touch but is a 24px island pinned in the corner on top of the full-card `onClick={onOpen}`; a slightly-off tap opens the modal. No confirmation; only a 5s Undo.
- **Why it's bad:** The recs-skewing action is the hardest target on the card and conflicts with the open action; excludes one-handed/motor-impaired users.
- **Suggested fix:** 44px target, higher border contrast; consider moving "Not interested" into the modal or a long-press menu on touch.

### [P3-3] Modal has no focus trap — focus escapes behind the dialog
- **Severity:** High
- **Location:** `components/MovieModal.tsx:35-48` (initial focus + Esc only)
- **What happens:** `aria-modal="true"` set but Tab from the last element moves focus to nav/page behind the backdrop; background isn't `inert`/`aria-hidden`, so SR reads both layers.
- **Why it's bad:** WCAG 2.4.3; SR/keyboard users get lost in obscured content.
- **Suggested fix:** Trap Tab/Shift+Tab within the dialog; set background `inert` or `aria-hidden` while open; restore focus to the trigger on close.

### [P3-4] StarRating: too small to tap + weak SR semantics
- **Severity:** High
- **Location:** `components/StarRating.tsx:28-45`; size "sm" `text-lg` + `padding:0.25rem` ≈ 26px, `gap-0.5`
- **What happens:** Five ~26px stars 2px apart on every card; tapping 3 vs 4 one-handed is a coin flip. `aria-label` is "3 star"/"…(click to clear)" — never announces current value or that it's a rating group; no `radiogroup`/`aria-valuenow`.
- **Why it's bad:** Mis-rates for motor/one-handed users; SR hears five disconnected "N star" buttons. WCAG 2.5.8, 4.1.2, 1.3.1.
- **Suggested fix:** ≥44px effective target on coarse pointers + larger gap; wrap in `role="radiogroup" aria-label="Rate this movie"`; `aria-checked`/`aria-label="Rate N out of 5"`; `aria-hidden` the ★ glyph.

### [P3-5] `chip-row` hidden scrollbar + mask hides off-screen genres
- **Severity:** Medium
- **Location:** `globals.css` `.chip-row` (`overflow-x:auto; scrollbar-width:none; mask-image`); used `app/page.tsx:284` (taste) and `:295` (mood + 12 genres)
- **What happens:** At 375px the mode bar's ~10 off-screen genres are cued only by a 28px gradient fade — easily missed; keyboard users get no visible scroll affordance.
- **Why it's bad:** Most genres are perceptually unreachable on mobile. Affects mobile + low-vision.
- **Suggested fix:** Add a visible affordance (chevron/"More", faint scrollbar on coarse pointers, or `flex-wrap:wrap` at ≤520px); ensure focused chips scroll into view.

### [P3-6] Decorative emoji announced as content by screen readers
- **Severity:** Medium
- **Location:** Nav `🎬` (`Nav.tsx:41`); mood `app/page.tsx:304`; sort labels `search/page.tsx:32-35`; `📺` `app/page.tsx:332`; People `🎭` `search/page.tsx:478` (refresh `↻` and EmptyState emoji are correctly hidden)
- **What happens:** SR reads "chart increasing trending", "television my services only", "clapper board Movie Night AI". Inconsistent — some hidden, most not.
- **Why it's bad:** Verbose noise on every control. WCAG 1.1.1.
- **Suggested fix:** Wrap decorative emoji in `<span aria-hidden="true">` (as already done elsewhere) or move to CSS.

### [P3-7] Modal poster/title header cramped + variable contrast at 375px
- **Severity:** Medium
- **Location:** `components/MovieModal.tsx:158-202` (header `marginTop:-4rem`, 100px poster beside flex text)
- **What happens:** ~343px dialog → ~223px for the title column; 1.4rem 800-weight title + meta line crowds, the `-4rem` pull places it over variable backdrop contrast, the action row can wrap to 3 lines, and the title can run under the top-right close button.
- **Why it's bad:** Cramped, variable-contrast header on the smallest screens.
- **Suggested fix:** Below ~480px stack poster above text, reduce title to ~1.2rem, trim meta to year + runtime; keep title clear of the close button.

### [P3-8] Low-contrast tertiary text below WCAG AA in several spots
- **Severity:** Medium
- **Location:** `.filter-label` `#71717a` (`globals.css:326`), watchlist "Genre:" `#71717a` (`watchlist/page.tsx:175`), share "Already Watched" `#71717a` (`share/page.tsx:47`), share dimmed tiles `opacity:0.6` (`share/page.tsx:99-101`), JustWatch link `#71717a` (`MovieModal.tsx:246`)
- **What happens:** `#71717a` on `#09090b` ≈ 4.0:1 (under 4.5:1 AA). The `--text-3` (#8b8b96) token was introduced as the floor but raw `#71717a` still appears here; the share dimmed tiles multiply `--text-3` by 0.6 → well under 3:1.
- **Why it's bad:** Low-vision users and bright-sunlight mobile can't read these. WCAG 1.4.3.
- **Suggested fix:** Replace remaining running-text `#71717a` with `var(--text-3)` or brighter; dim only the poster on share, not the title/year text.

### [P3-9] Undo toast times out before AT/slower users can reach it
- **Severity:** Medium
- **Location:** `components/Toast.tsx:13,19-21`; durations 3000 default / 4000 watchlist / 5000 For You
- **What happens:** `role="status" aria-live="polite"` is good, but the Undo button auto-dismisses in 4-5s. An SR user must hear the polite announcement, parse it, locate the bottom-center pill, and activate Undo before the timer — often impossible. One-handed users miss the far-away pill.
- **Why it's bad:** The recovery affordance for destructive actions is unreachable for slower/AT users. WCAG 2.2.1 (Timing Adjustable).
- **Suggested fix:** For action toasts, pause the timer on hover/focus, extend to ≥8-10s, and move focus to (or otherwise make persistent) the Undo button.

### [P3-10] Filter drawer `filter-label` fixed 72px is cramped at 375px
- **Severity:** Low
- **Location:** `globals.css:325-333` (`.filter-label width:72px`), `search/page.tsx:519-595`
- **What happens:** With `flex-wrap:wrap`, the 72px label sits alone while ~18 genre chips wrap below it inconsistently; wide chips ("Before 1980", "90–120 min") crowd; labels are also low-contrast (P3-8).
- **Why it's bad:** Noisy and hard to scan; label-to-chips relationship unclear once chips wrap.
- **Suggested fix:** Below 520px stack the label as a full-width row above its chip group; widen/raise label contrast.

### [P3-11] Reduce-motion freezes the spinner into a static, label-less icon
- **Severity:** Low
- **Location:** `globals.css` global `prefers-reduced-motion` clamp; `.spinner`/`.spin-icon`; `search/page.tsx:689` load-more, `app/page.tsx:276` refresh
- **What happens:** The global rule correctly kills shimmer/stagger/slides, but also stops `.spinner`/`.spin-icon` → the load-more indicator is a frozen ↻ with no label.
- **Why it's bad:** Reduce-motion users get no perceivable loading feedback; a frozen spinner reads as broken. WCAG 4.1.3.
- **Suggested fix:** Pair every spinner with visible or visually-hidden "Loading…" text in a `role="status"` region; optionally a slow opacity pulse that respects reduce-motion.

### [P3-12] Nav at 375px: 4 links `space-between` become tiny, tightly-spaced targets
- **Severity:** Low
- **Location:** `globals.css:283-298` (`@media max-width:520px`), `Nav.tsx:45-66`
- **What happens:** Links shrink to `0.35rem 0.5rem`/0.8rem and pack into ~343px; each ~36-40px tall with minimal gaps → easy mis-taps.
- **Why it's bad:** Primary nav is the most-tapped UI. WCAG 2.5.8.
- **Suggested fix:** `min-height:44px` + horizontal gap on coarse pointers; consider a bottom tab bar for the 4 destinations on phones.

### [P3-13] Watchlist "watched ✓" badge has no SR label; status invisible to SR
- **Severity:** Low
- **Location:** `watchlist/page.tsx:239-250` (✓ badge), 261-269 (stars), 273-286 (Unwatch/Remove)
- **What happens:** Watched state is only a purple ✓ glyph over the poster (not `aria-hidden`, no label); SR users infer "watched" only from the "↩ Unwatch" button.
- **Why it's bad:** Core state invisible to SR users. WCAG 1.3.1, 1.1.1.
- **Suggested fix:** Add a visually-hidden "Watched" label (or `aria-label` on the badge); `aria-hidden` the decorative ✓; ideally fold status into the card's accessible name.

### [P3-14] Share tiles: uneven heights + star string unreadable to SR
- **Severity:** Low
- **Location:** `app/share/page.tsx:37,50` (`minmax(160px,1fr)`), `:98` (title no clamp), `:101` (`"★".repeat(n)`)
- **What happens:** Titles wrap to varying line counts → uneven tile heights; the rating renders as literal ★ chars with no label → SR reads "black star black star black star".
- **Why it's bad:** Uneven layout; meaningless rating for SR. WCAG 1.1.1. (Low — share is read-only/secondary.)
- **Suggested fix:** `-webkit-line-clamp:2` on the title; replace the ★ string with an `aria-label`/visually-hidden "Rated N out of 5".

---

## Appendix — methodology
Each persona agent read the full frontend (`app/*`, `components/*`, `lib/*`, `globals.css`) and the
relevant backend routers, then reasoned through concrete sessions rather than running a browser.
Findings cite `file:line` against the code as of this pass. The compiler verified the two
highest-stakes bug claims against source: **P2-9** (StarRating clear) confirmed; **P2-11**
("Highest Rated" junk) found largely invalid because `movies.py:87-88` already applies a
`vote_count.gte=300` floor. Developers should still reproduce before large refactors.

---

## Resolution log (fix pass)

**Fully fixed in code:**

- **P1-1 / P1-2** — `app/page.tsx`: dedicated first-run onboarding panel (welcome + 1-2-3 steps + Discover CTA) replaces the skeleton-then-empty flash; causal empty-state copy ("built from the movies you rate").
- **P1-4** — `MovieCard.tsx`: "Seen it? Rate:" / "Your rating:" label above the stars.
- **P1-7** — `watchlist/page.tsx`: "🔗 Share list" button in the header links to `/share` (feature is now reachable).
- **P1-8** — `app/page.tsx`: taste strip relabeled "What we've learned", `title` tooltips, person prefix explained.
- **P1-9** — kicker reworded "Because you loved X" → "Inspired by X" (no overclaim).
- **P1-10 / P2-1** — single neutral badge "✨ For You"; an honest inline note appears when the LLM ranker is down (`source==="tmdb"`).
- **P1-12** — `watchlist/page.tsx`: removed the "See AI Picks" link that looped to an empty page; empty CTA now points only to Discover.
- **P2-3** — `refreshCount` resets to 0 on every mode/streaming switch.
- **P2-4** — "Not interested" now uses an undo-window: the feedback POST is deferred until the 5s window closes, so Undo simply cancels it — no POST/DELETE race, always reversible in-window.
- **P2-7 / P2-8** — `app/page.tsx` fetches `getRatings()` + `getWatchlist()` on mount and seeds the card-badge maps; "+ Watchlist"/stars now reflect reality on cache hits.
- **P2-9 / P1-14** — `StarRating.tsx`: dropped the `hovered===0` gate (clear works on mouse + touch), stable `key={star}` (no hover-reset remount); star-pop preserved via a keyed inner span.
- **P2-10** — `search/page.tsx`: `readyKeyRef` gate blocks page-2 until page-1 of the current query resolves; `loadMoreBusyRef` reset on key change.
- **P2-13** — streaming toggle with zero services renders in a gold "needs services" warning state instead of looking active.
- **P2-14** — over-filtered empty state has a single "Reset all filters" button (clears mode + streaming together).
- **P2-16 / P3-9** — `Toast.tsx`: monotonic `id` restarts the timer on identical messages; timer pauses on hover/focus; action toasts use longer durations.
- **P3-1 / P3-2 / P3-4 / P3-12** — `globals.css`: coarse-pointer touch targets raised to 44px (chips, tabs, nav links, dismiss-✕, search-clear, star buttons); dismiss-✕ contrast bumped.
- **P3-3** — `MovieModal.tsx`: full focus trap (Tab/Shift+Tab cycle), background `main`/`nav` set `aria-hidden` while open, focus restored to the trigger on close, close button 44px.
- **P3-5 (partial)** — chip-row touch targets fixed; horizontal scroll + mask retained (a visible "more" affordance is the deferred half).
- **P3-6** — decorative emoji wrapped in `aria-hidden` spans across moods/streaming/nav-equivalent labels.
- **P3-7** — `globals.css`: modal header stacks (poster above text, smaller title) below 480px.
- **P3-8** — remaining `#71717a` running text → `var(--text-3)` (filter label, watchlist "Genre:", JustWatch link, share); share dims only the poster, not the text.
- **P3-10** — filter-label goes full-width above its chip group below 520px.
- **P3-11** — `.sr-only` "Loading…" added to the load-more spinner; spinners pulse (opacity) instead of freezing under `prefers-reduced-motion`.
- **P3-13** — watchlist watched ✓ badge gets `role="img" aria-label="Watched"`, glyph `aria-hidden`.
- **P3-14** — share tiles: title `-webkit-line-clamp:2`, rating exposed as `aria-label="Rated N out of 5"`.
- **P2-2 (partial)** — candidate page window widened `seed%3` → `seed%8` so refreshes rotate more.

**Confirmed non-issue:**
- **P2-11** — "Highest Rated returns junk" is invalid; backend already floors `vote_count.gte=300` for `vote_average.desc` (`movies.py:87-88`). No change.◊

**Consciously deferred (product/data decisions — left for a follow-up, not silently dropped):**
- **P1-5 / P1-6** — *Rating force-marks "Watched" + disabled button.* This is intentional behavior (`rateAndAddWatched`) the product was built around. Mitigated via the clearer "Seen it? Rate:" label (communicates the assumption) and reversibility through the modal. Full decoupling of rate-vs-watched is a product call.
- **P2-5 (partial)** — Undo now restores the correct item at its original position (P2-6 position fix), and the toast timer is robust, but only the **most-recent** action shows an Undo (Gmail-style). A full multi-action undo queue was deferred.
- **P2-6 (partial)** — list position on undo is fixed; full Rating/Watchlist data symmetry on remove+undo is a backend data-model decision, deferred.
- **P2-15** — the undo-window now prevents *accidental* permanent exclusion, but a "Not interested" management page (the API exists) and time-decay of exclusions were deferred.
- **P1-13** — contextual "rate films you've seen" nudge on Discover when arriving from onboarding: minor, deferred.
- **P2-2 (UI half)** — "you've seen most of your matches" message for a shrunken pool needs frontend plumbing for non-empty lists; deferred.

**Verification:** `npx tsc --noEmit` clean · `npm run build` passes (6 routes) · `recommendations.py` parses.

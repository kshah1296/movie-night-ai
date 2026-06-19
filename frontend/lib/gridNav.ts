"use client";

import type { KeyboardEvent } from "react";

// UX2 — arrow-key roving across a card grid. Attach as onKeyDown to the grid container;
// each card must be focusable and carry `data-card`. Left/Right move by one; Up/Down move
// by a row (columns inferred from the cards' offsetTop). Enter/Space is handled per-card.
export function gridArrowNav(e: KeyboardEvent<HTMLElement>): void {
  const keys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"];
  if (!keys.includes(e.key)) return;

  const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card]"));
  const idx = cards.indexOf(document.activeElement as HTMLElement);
  if (idx === -1) return; // focus isn't on a card — let the event pass

  e.preventDefault();
  let next = idx;
  if (e.key === "ArrowRight") next = Math.min(idx + 1, cards.length - 1);
  else if (e.key === "ArrowLeft") next = Math.max(idx - 1, 0);
  else {
    const top0 = cards[0].offsetTop;
    let cols = cards.findIndex((c) => c.offsetTop > top0);
    if (cols === -1) cols = cards.length; // single row
    next = e.key === "ArrowDown"
      ? Math.min(idx + cols, cards.length - 1)
      : Math.max(idx - cols, 0);
  }
  cards[next]?.focus();
}

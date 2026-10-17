"use client";

// Points at a real control on the page. Controls are found by a stable
// data-assistant-id attribute (never by their text or position), and only if
// they are actually on screen. If the control is not there -- the page has
// changed, or it only appears after an earlier step -- this says so and the
// assistant falls back to written instructions instead of pretending.

export const HIGHLIGHT_CLASS = "assistant-highlight";
const HIGHLIGHT_MS = 7000;

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  // Inside a closed <details>, or scrolled away inside a hidden panel.
  const details = el.closest("details");
  if (details && !details.open && !el.closest("summary")) return false;
  return true;
}

// The first visible element with this id. A control can exist twice (the header
// link and the phone's bottom bar); only the one on screen counts.
export function findTarget(id: string): HTMLElement | null {
  if (!/^[a-z0-9-]+$/i.test(id)) return null;
  const matches = document.querySelectorAll(`[data-assistant-id="${id}"]`);
  for (const el of matches) if (isVisible(el)) return el as HTMLElement;
  return null;
}

let clearTimer: number | undefined;
let current: HTMLElement | null = null;

export function clearHighlight(): void {
  window.clearTimeout(clearTimer);
  current?.classList.remove(HIGHLIGHT_CLASS);
  current = null;
}

// Scrolls the control into view and rings it for a few seconds. Returns false if
// it could not be found. Never clicks or changes anything.
export function highlightTarget(id: string): boolean {
  const el = findTarget(id);
  if (!el) return false;
  clearHighlight();
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
  el.classList.add(HIGHLIGHT_CLASS);
  current = el;
  clearTimer = window.setTimeout(clearHighlight, HIGHLIGHT_MS);
  return true;
}

// When to show the small cards that sit beside the page, and how often. Three signals, three messages:
//
//   done    a file was just saved               -> "All done?" with the install invitation
//   browse  meaningful browsing, nothing started -> "Keep FreePDFScanner close" (gentle install reminder)
//   help    a file was chosen but nothing saved, and the visitor went quiet -> "Still working?" offer of help.
//           Never an install pitch: help them finish first.
//
// Strictly a device-local convenience, like the Hint tips: the state below lives in this browser's
// localStorage and is never sent anywhere (no analytics, no account). It is the visitor's own
// "don't ask me again" memory, so it is classed as functional storage. The signals themselves are plain
// in-page events and counters held in memory; nothing about browsing is recorded or reported.

export const REMINDER_KEY = "ds_install_reminder";
export const TASK_COMPLETE_EVENT = "ds-task-complete";

const DAY = 24 * 60 * 60 * 1000;

export type Kind = "done" | "browse" | "help";

// How long to stay quiet after each answer to an install card.
export const QUIET_MS = {
  closed: 7 * DAY, // the small close button
  notYet: 3 * DAY, // "Not yet": they were mid-task, so a later success may be a better moment
  maybeLater: 14 * DAY,
  guideShown: 60 * DAY, // they saw the steps
  shown: 1 * DAY, // minimum gap even with no answer (card left open, page closed)
} as const;
export const HELP_QUIET_MS = { shown: 1 * DAY, dismissed: 3 * DAY } as const;

// Stop for good once an install card has been turned down this many times without the person engaging.
export const MAX_DISMISSALS = 3;
export const MAX_HELP_DISMISSALS = 3;

// Starting thresholds for "meaningful browsing" and "went quiet" (to be tuned, not universal rules).
export const BROWSE = { minActiveMs: 60_000, minPagesForShort: 3, shortActiveMs: 20_000 } as const;
export const HELP_IDLE_MS = 90_000;
// After the card is up, wait a calm moment before showing it, and give up if the page never calms down.
export const SHOW_DELAY_MS = { done: 4_000, browse: 1_500, help: 0 } as const;

export interface ReminderState {
  v: 1;
  // Never again (the "don't remind me again" choice, or the app is installed).
  off?: boolean;
  // Earliest time (ms since epoch) an install card may appear again.
  quietUntil?: number;
  dismissals?: number;
  helpQuietUntil?: number;
  helpDismissals?: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

export function readState(storage: StorageLike | null): ReminderState {
  try {
    const raw = storage?.getItem(REMINDER_KEY);
    if (!raw) return { v: 1 };
    const p = JSON.parse(raw) as Record<string, unknown>;
    const out: ReminderState = { v: 1 };
    if (p.off === true) out.off = true;
    const q = num(p.quietUntil);
    if (q !== undefined) out.quietUntil = q;
    const d = num(p.dismissals);
    if (d !== undefined) out.dismissals = Math.floor(d);
    const hq = num(p.helpQuietUntil);
    if (hq !== undefined) out.helpQuietUntil = hq;
    const hd = num(p.helpDismissals);
    if (hd !== undefined) out.helpDismissals = Math.floor(hd);
    return out;
  } catch {
    return { v: 1 };
  }
}

export function writeState(storage: StorageLike | null, state: ReminderState): boolean {
  try {
    if (!storage) return false;
    storage.setItem(REMINDER_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export interface Context {
  now: number;
  standalone: boolean;
  // A card is on screen right now (only one at a time).
  cardVisible: boolean;
  // Per page load: at most one install card and one help card.
  installShownThisPage: boolean;
  helpShownThisPage: boolean;
}

// Whether the card of this kind may be offered now.
export function mayShow(kind: Kind, state: ReminderState, ctx: Context): boolean {
  if (ctx.cardVisible) return false;
  if (kind === "help") {
    if (ctx.helpShownThisPage) return false;
    if ((state.helpDismissals ?? 0) >= MAX_HELP_DISMISSALS) return false;
    return state.helpQuietUntil === undefined || ctx.now >= state.helpQuietUntil;
  }
  if (ctx.standalone) return false; // already installed and running as an app
  if (ctx.installShownThisPage) return false;
  if (state.off) return false;
  if ((state.dismissals ?? 0) >= MAX_DISMISSALS) return false;
  return state.quietUntil === undefined || ctx.now >= state.quietUntil;
}

export type Answer = keyof typeof QUIET_MS | "never" | "installed";

// The state after the person responds to an install card (or after it is shown, with answer "shown").
export function afterAnswer(state: ReminderState, answer: Answer, now: number): ReminderState {
  if (answer === "never" || answer === "installed") return { ...state, off: true };
  const quiet = now + QUIET_MS[answer];
  const next: ReminderState = { ...state, quietUntil: Math.max(state.quietUntil ?? 0, quiet) };
  // Only the close button and "Maybe later" count as turning the card down.
  if (answer === "closed" || answer === "maybeLater") next.dismissals = (state.dismissals ?? 0) + 1;
  return next;
}

export function afterHelp(state: ReminderState, answer: "shown" | "dismissed", now: number): ReminderState {
  const quiet = now + HELP_QUIET_MS[answer];
  const next: ReminderState = { ...state, helpQuietUntil: Math.max(state.helpQuietUntil ?? 0, quiet) };
  if (answer === "dismissed") next.helpDismissals = (state.helpDismissals ?? 0) + 1;
  return next;
}

// ---- the three signals ----------------------------------------------------------------------------------

export interface Activity {
  // Time with the page visible AND the person actually interacting (pointer, scroll, key, touch).
  activeMs: number;
  // Distinct pages visited in this tab since it opened.
  pages: number;
  // A file was chosen on some page.
  taskStarted: boolean;
  // A file was saved.
  taskCompleted: boolean;
  // Milliseconds since the last interaction.
  idleMs: number;
}

export function newActivity(): Activity {
  return { activeMs: 0, pages: 1, taskStarted: false, taskCompleted: false, idleMs: 0 };
}

// Meaningful browsing with nothing started: several pages explored, or a good minute of real interaction.
export function browsingEngaged(a: Activity): boolean {
  if (a.taskStarted || a.taskCompleted) return false;
  if (a.activeMs >= BROWSE.minActiveMs) return true;
  return a.pages >= BROWSE.minPagesForShort && a.activeMs >= BROWSE.shortActiveMs;
}

// Started but not finished, and quiet for a while. Quiet alone proves nothing (they may be reading),
// which is why this only offers help and never asks for anything.
export function unfinishedDue(a: Activity): boolean {
  return a.taskStarted && !a.taskCompleted && a.idleMs >= HELP_IDLE_MS;
}

// ---- when the page is calm enough to interrupt ------------------------------------------------------

export interface PageProbe {
  hidden: boolean;
  dialogOpen: boolean;
  typing: boolean;
}

export function readyToShow(p: PageProbe): boolean {
  return !p.hidden && !p.dialogOpen && !p.typing;
}

export function probePage(doc: Document): PageProbe {
  const active = doc.activeElement as HTMLElement | null;
  const typing = !!active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
  const dialogOpen = !!doc.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]');
  return { hidden: doc.visibilityState === "hidden", dialogOpen, typing };
}

// Called by the code that has just finished saving a file. Nothing is recorded or sent; the card
// decides for itself whether it is a good moment.
export function announceTaskComplete(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TASK_COMPLETE_EVENT));
}

// Desktop exit intent: the pointer leaves through the top of the window (towards tabs and address bar).
// Phones have no reliable equivalent, so nothing is attempted there.
export function isExitIntent(e: { clientY: number; relatedTarget: unknown }, finePointer: boolean): boolean {
  return finePointer && e.relatedTarget === null && e.clientY <= 0;
}

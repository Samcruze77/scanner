// The visitor's choice about contextual tips, and which tips they have already seen.
//
// One small record in this browser's localStorage (never sent anywhere, no account, no analytics):
//   tips       "unset"  nobody has answered the one-time question yet
//              "on"     "Yes, show me tips"
//              "off"    "No thanks": no tips and no further questions
//   dismissed  ids of tips the visitor closed or completed, so none is explained twice
//   asked      how many visits the one-time question was shown and ignored (it stops after MAX_ASKS)
// The floating "Ask me" assistant does not depend on this choice; it is always there.

export type TipsChoice = "unset" | "on" | "off";

export interface GuidanceState {
  tips: TipsChoice;
  dismissed: string[];
  asked: number;
}

// An ignored question is asked again on a later visit, but only this many times in all.
export const MAX_ASKS = 3;

export const GUIDANCE_KEY = "docuscanner.guidance.v1";
export const GUIDANCE_EVENT = "docuscanner:guidance-change";

export const EMPTY_GUIDANCE: GuidanceState = Object.freeze({ tips: "unset", dismissed: [], asked: 0 }) as GuidanceState;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseGuidance(raw: string | null): GuidanceState {
  if (!raw) return EMPTY_GUIDANCE;
  try {
    const data = JSON.parse(raw) as Partial<GuidanceState>;
    const tips: TipsChoice = data.tips === "on" || data.tips === "off" ? data.tips : "unset";
    const dismissed = Array.isArray(data.dismissed) ? data.dismissed.filter((d): d is string => typeof d === "string").slice(0, 200) : [];
    const asked = typeof data.asked === "number" && Number.isInteger(data.asked) && data.asked > 0 ? Math.min(data.asked, 99) : 0;
    return { tips, dismissed, asked };
  } catch {
    return EMPTY_GUIDANCE;
  }
}

export function readGuidanceRaw(storage: StorageLike | null): string | null {
  try {
    return storage?.getItem(GUIDANCE_KEY) ?? null;
  } catch {
    return null;
  }
}

function write(storage: StorageLike | null, state: GuidanceState): boolean {
  try {
    storage?.setItem(GUIDANCE_KEY, JSON.stringify(state));
    return !!storage;
  } catch {
    return false;
  }
}

export function setTipsChoice(storage: StorageLike | null, tips: TipsChoice): GuidanceState {
  const next = { ...parseGuidance(readGuidanceRaw(storage)), tips };
  write(storage, next);
  return next;
}

export function dismissTipId(storage: StorageLike | null, id: string): GuidanceState {
  const current = parseGuidance(readGuidanceRaw(storage));
  if (current.dismissed.includes(id)) return current;
  const next = { ...current, dismissed: [...current.dismissed, id] };
  write(storage, next);
  return next;
}

// Tips appear unless the visitor said no. Before the one-time question is answered the few essential
// tips (how to move around a page on a phone) may still appear, because they only ever show once.
export function tipsAllowed(state: GuidanceState): boolean {
  return state.tips !== "off";
}

export function shouldShowTip(state: GuidanceState, id: string): boolean {
  return tipsAllowed(state) && !state.dismissed.includes(id);
}

// The one-time question is asked only while nobody has answered it (and not endlessly if it is ignored).
export function shouldAskTips(state: GuidanceState): boolean {
  return state.tips === "unset" && state.asked < MAX_ASKS;
}

// The question was on screen for a while and got no answer.
export function noteAsked(storage: StorageLike | null): GuidanceState {
  const current = parseGuidance(readGuidanceRaw(storage));
  const next = { ...current, asked: Math.min(current.asked + 1, 99) };
  write(storage, next);
  return next;
}

// "Show tips again" after turning them off: forgets what was dismissed so they can be useful again.
export function resetTips(storage: StorageLike | null): GuidanceState {
  const next: GuidanceState = { tips: "on", dismissed: [], asked: parseGuidance(readGuidanceRaw(storage)).asked };
  write(storage, next);
  return next;
}

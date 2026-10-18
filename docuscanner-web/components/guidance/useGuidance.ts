"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  dismissTipId,
  EMPTY_GUIDANCE,
  noteAsked,
  GUIDANCE_EVENT,
  GUIDANCE_KEY,
  parseGuidance,
  readGuidanceRaw,
  resetTips,
  setTipsChoice,
  shouldShowTip,
  type GuidanceState,
  type TipsChoice,
} from "@/utils/guidance/preferences";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// useSyncExternalStore needs a stable snapshot: compare the raw string, parse only when it changes.
let lastRaw: string | null | undefined;
let lastState: GuidanceState = EMPTY_GUIDANCE;
// Storage can be blocked (private mode); then choices live for this page view only.
let memory: GuidanceState | null = null;

function snapshot(): GuidanceState {
  if (memory) return memory;
  const raw = readGuidanceRaw(storage());
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastState = parseGuidance(raw);
  }
  return lastState;
}

function subscribe(callback: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === GUIDANCE_KEY) callback();
  };
  window.addEventListener(GUIDANCE_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(GUIDANCE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

function commit(next: GuidanceState) {
  // If nothing could be stored, keep the answer in memory so the question is not re-asked this visit.
  if (readGuidanceRaw(storage()) !== JSON.stringify(next)) memory = next;
  window.dispatchEvent(new Event(GUIDANCE_EVENT));
}

export function useGuidance() {
  // Server render and first client render: tips unset and nothing shown, so nothing flashes in.
  const state = useSyncExternalStore(subscribe, snapshot, () => EMPTY_GUIDANCE);
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const setTips = useCallback((tips: TipsChoice) => commit(setTipsChoice(storage(), tips)), []);
  const dismiss = useCallback((id: string) => commit(dismissTipId(storage(), id)), []);
  const turnOnAgain = useCallback(() => commit(resetTips(storage())), []);
  const markAsked = useCallback(() => commit(noteAsked(storage())), []);
  return {
    hydrated,
    state,
    tips: state.tips,
    showTip: (id: string) => hydrated && shouldShowTip(state, id),
    setTips,
    dismiss,
    turnOnAgain,
    markAsked,
  };
}

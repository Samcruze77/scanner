"use client";

import { useSyncExternalStore } from "react";
import { hasConsent, subscribeConsent, type ConsentCategory } from "./consent";

// Live view of one consent category for React components. Server render and
// first client render are always "not consented" (opt-in), so nothing
// non-essential is ever rendered before the visitor's stored choice is read.
export function useConsent(category: ConsentCategory): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeConsent(onChange),
    () => hasConsent(category),
    () => false,
  );
}

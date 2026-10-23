"use client";

import { useSyncExternalStore } from "react";

// True while the query matches (re-renders when it changes). False on the server and before the browser reports.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", callback);
      return () => m.removeEventListener("change", callback);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { getAudience, subscribeAudience, type Audience } from "@/utils/analytics/audience";

// The server snapshot is "pending": nothing is tracked or loaded before hydration.
export function useAudience(): Audience {
  return useSyncExternalStore(subscribeAudience, getAudience, () => "pending");
}

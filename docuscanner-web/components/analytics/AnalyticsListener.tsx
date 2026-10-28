"use client";

// Mounted once in the root layout. Tracks app_open on first load of a
// browser session and page_view on every route change -- but only for
// visitors who have opted in to analytics (utils/consent/consent.ts). Without
// consent, or while the administrator check is pending, nothing is sent and no identifiers
// are created; administrators are never tracked. When consent is
// granted mid-visit, the current page is counted from that moment. Renders
// nothing.

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { trackAppOpen, trackPageView } from "@/utils/analytics/events";
import { isNewSessionThisPageLoad } from "@/utils/analytics/identity";
import { hasConsent, subscribeConsent } from "@/utils/consent/consent";
import { mayTrack } from "@/utils/analytics/audience";
import { useAudience } from "./useAudience";

function AnalyticsListenerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasTrackedAppOpen = useRef(false);
  const lastTrackedKey = useRef<string | null>(null);
  // Nothing is sent until the sign-in state and administrator check have settled, and never
  // for a verified administrator (see utils/analytics/audience.ts).
  const audience = useAudience();

  useEffect(() => {
    const record = () => {
      if (!hasConsent("analytics") || !mayTrack(audience)) return;
      const key = `${pathname}?${searchParams}`;
      if (lastTrackedKey.current === key) return;
      lastTrackedKey.current = key;
      if (!hasTrackedAppOpen.current) {
        hasTrackedAppOpen.current = true;
        if (isNewSessionThisPageLoad()) void trackAppOpen();
      }
      void trackPageView();
    };
    record();
    // Consent granted after the page loaded: start counting from now.
    return subscribeConsent(record);
  }, [pathname, searchParams, audience]);

  // Consent withdrawn: forget what was already tracked so a later opt-in counts afresh.
  useEffect(() => {
    return subscribeConsent(() => {
      if (!hasConsent("analytics")) {
        lastTrackedKey.current = null;
        hasTrackedAppOpen.current = false;
      }
    });
  }, []);

  return null;
}

export function AnalyticsListener() {
  return (
    <Suspense fallback={null}>
      <AnalyticsListenerInner />
    </Suspense>
  );
}

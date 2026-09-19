"use client";

// Mounted once in the root layout. Tracks app_open on first load of a
// browser session and page_view on every route change -- guests included,
// no signup required. Renders nothing.

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { trackAppOpen, trackPageView } from "@/utils/analytics/events";
import { isNewSessionThisPageLoad } from "@/utils/analytics/identity";

function AnalyticsListenerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasTrackedAppOpen = useRef(false);

  useEffect(() => {
    if (!hasTrackedAppOpen.current) {
      hasTrackedAppOpen.current = true;
      if (isNewSessionThisPageLoad()) {
        void trackAppOpen();
      }
    }
    void trackPageView();
    // Re-run on every path/query change so SPA navigations count as page views.
  }, [pathname, searchParams]);

  return null;
}

export function AnalyticsListener() {
  return (
    <Suspense fallback={null}>
      <AnalyticsListenerInner />
    </Suspense>
  );
}

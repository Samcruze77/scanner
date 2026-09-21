"use client";

// Advertising placeholders, in three reusable forms:
//   AdTop     - banner at the top of a page
//   AdSide    - desktop right-hand column; on small screens it drops below the
//               page content instead of squeezing in beside it
//   AdBottom  - banner at the bottom of a page
// (AdInline is the same box for use between sections of a workspace.)
//
// Rules every slot follows, so an ad can never get in the way of the work:
//  - always in normal document flow (never fixed, sticky over content or
//    absolute), so it can't cover document controls, the editor or signing UI;
//  - reserves its height up front, so late-loading ads don't shift the page;
//  - clipped to its own box (no horizontal overflow) and visibly separated from
//    the tools around it by a border, a label and spacing.
//
// No provider is connected: the boxes are placeholders and are not tracked.

import { useEffect, useRef } from "react";
import { trackAdClick, trackAdImpression } from "@/utils/analytics/events";
import { AD_PROVIDER, ADS_LIVE, type AdPlacement } from "@/utils/ads/config";

const BOX: Record<AdPlacement, string> = {
  top: "h-16 w-full sm:h-20",
  bottom: "h-16 w-full sm:h-20",
  inline: "h-20 w-full sm:h-24",
  // A "medium rectangle" (300x250). Centred and capped on small screens.
  side: "mx-auto h-[250px] w-full max-w-[336px] lg:max-w-[300px]",
};

function AdSlot({ placement, className }: { placement: AdPlacement; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Count one impression the first time a live ad is at least half visible.
  useEffect(() => {
    if (!ADS_LIVE || !AD_PROVIDER || !ref.current || typeof IntersectionObserver === "undefined") return;
    const node = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void trackAdImpression(placement, AD_PROVIDER);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [placement]);

  return (
    <aside
      aria-label="Advertisement"
      data-ad-placement={placement}
      className={`min-w-0 max-w-full overflow-hidden ${className ?? ""}`}
    >
      <p className="mb-1.5 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Advertisement
      </p>
      <div
        ref={ref}
        onClick={() => {
          if (ADS_LIVE && AD_PROVIDER) void trackAdClick(placement, AD_PROVIDER);
        }}
        className={`flex items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100/60 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 ${BOX[placement]}`}
      >
        {ADS_LIVE ? null : "Ad space"}
      </div>
    </aside>
  );
}

export function AdTop({ className }: { className?: string }) {
  return <AdSlot placement="top" className={className} />;
}

export function AdSide({ className }: { className?: string }) {
  return <AdSlot placement="side" className={className} />;
}

export function AdBottom({ className }: { className?: string }) {
  return <AdSlot placement="bottom" className={className} />;
}

export function AdInline({ className }: { className?: string }) {
  return <AdSlot placement="inline" className={className} />;
}

"use client";

// Ad slots, in three reusable forms:
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
// A slot asks the public `ads-eligible` Edge Function for a real campaign to
// show. That call, the image, and click/impression tracking are all
// wrapped so a failure at any point just falls back to today's empty
// placeholder box -- ad delivery is strictly non-critical and must never
// block or slow down the scanner/converter workflow it sits next to.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AdPlacement } from "@/utils/ads/config";
import { getEligibleAd, trackAdClickEvent, trackAdImpressionEvent, type EligibleAd } from "@/utils/ads/eligible";

const BOX: Record<AdPlacement, string> = {
  top: "h-16 w-full sm:h-20",
  bottom: "h-16 w-full sm:h-20",
  inline: "h-20 w-full sm:h-24",
  // A "medium rectangle" (300x250). Centred and capped on small screens.
  side: "mx-auto h-[250px] w-full max-w-[336px] lg:max-w-[300px]",
};

// Client-side mirror of the server-side allowlist in the admin-ads Edge
// Function -- a second, independent check (defense in depth). Even if a
// malformed embed_url somehow reached the browser, this refuses to render
// an iframe for anything outside these hosts and falls back to the normal
// clickable creative instead.
const EMBED_HOST_ALLOWLIST = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
]);

function safeEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (!EMBED_HOST_ALLOWLIST.has(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function AdSlot({ placement, className }: { placement: AdPlacement; className?: string }) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const setNode = (el: HTMLElement | null) => {
    nodeRef.current = el;
  };
  const pathname = usePathname();
  const [ad, setAd] = useState<EligibleAd | null | undefined>(undefined);
  const impressionTracked = useRef(false);

  // Reset to "loading" synchronously during render when the slot/page
  // changes -- the React-documented pattern for clearing derived state on a
  // key change (useState, not a ref, since refs can't be touched at render
  // time) without an extra cascading render.
  const requestKey = `${placement}:${pathname}`;
  const [lastKey, setLastKey] = useState(requestKey);
  if (lastKey !== requestKey) {
    setLastKey(requestKey);
    setAd(undefined);
  }

  useEffect(() => {
    let cancelled = false;
    impressionTracked.current = false;
    getEligibleAd(placement, pathname || "/").then((result) => {
      if (!cancelled) setAd(result);
    });
    return () => {
      cancelled = true;
    };
  }, [placement, pathname]);

  useEffect(() => {
    if (!ad || !nodeRef.current || typeof IntersectionObserver === "undefined") return;
    const node = nodeRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !impressionTracked.current) {
          impressionTracked.current = true;
          trackAdImpressionEvent(ad, pathname || "/");
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ad]);

  return (
    <aside
      aria-label="Advertisement"
      data-ad-placement={placement}
      className={`min-w-0 max-w-full overflow-hidden ${className ?? ""}`}
    >
      <p className="mb-1.5 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        Advertisement
      </p>
      {ad && ad.destination_type === "embed" && safeEmbedUrl(ad.embed_url) ? (
        <div
          ref={setNode}
          className={`overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60 ${BOX[placement]}`}
        >
          <iframe
            src={safeEmbedUrl(ad.embed_url)!}
            title={ad.title ?? "Advertisement"}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="encrypted-media; picture-in-picture"
            loading="lazy"
          />
        </div>
      ) : ad ? (
        <a
          href={ad.click_url}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={() => trackAdClickEvent(ad, pathname || "/")}
          ref={setNode}
          className={`flex items-center gap-3 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100/60 dark:border-zinc-800 dark:bg-zinc-900/60 ${BOX[placement]}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- advertiser-hosted image, not part of the Next.js image pipeline */}
          <img
            src={ad.asset_url}
            alt={ad.alt_text ?? ad.title ?? "Advertisement"}
            onError={() => setAd(null)}
            className="h-full w-full object-cover"
          />
        </a>
      ) : (
        <div
          ref={setNode}
          className={`flex items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100/60 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 ${BOX[placement]}`}
        >
          {ad === undefined ? null : "Ad space"}
        </div>
      )}
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

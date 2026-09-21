// The common frame for the app's pages, and the place the ad policy lives.
//
// Ads pay the bills but must never get in the way of the work. Rules:
//  - Ads are always in normal document flow, never fixed, sticky over content or
//    absolute, so they can't cover a control, a download or a dialog.
//  - "workflow" pages (the scanner, an editor tool, a converter, a compressor: places
//    where someone is in the middle of something) get ONE banner, at the very bottom,
//    below everything they might press. Nothing above or beside the work.
//  - "content" pages (home, the hubs, history) may also have a slim banner under the
//    header and, on wide screens, a side column beside the list of choices.
//  - Every slot reserves its height up front (no layout jump) and is clipped to its
//    own box (no sideways scrolling). See components/ads/AdSlot.tsx.
//
// The content column can shrink (`min-w-0`) so nothing forces horizontal scrolling
// at phone widths.

import { AdBottom, AdSide, AdTop } from "@/components/ads/AdSlot";

const WIDTH = {
  // Room beside it for the ad column on desktop.
  wide: "max-w-6xl",
  narrow: "max-w-3xl",
  // The document workspace: as much room as the screen allows.
  workspace: "max-w-7xl",
} as const;

export function PageShell({
  children,
  width = "wide",
  ads = "content",
}: {
  children: React.ReactNode;
  width?: keyof typeof WIDTH;
  ads?: "content" | "workflow";
}) {
  const rail = ads === "content" && width === "wide";
  return (
    <main id="main" className={`mx-auto w-full flex-1 px-4 py-6 sm:px-6 sm:py-8 ${WIDTH[width]}`}>
      {ads === "content" && <AdTop className="mb-6" />}
      <div className={rail ? "lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8" : ""}>
        <div className="min-w-0">{children}</div>
        {rail && <AdSide className="mt-8 lg:sticky lg:top-20 lg:mt-0" />}
      </div>
      <AdBottom className="mt-12" />
    </main>
  );
}

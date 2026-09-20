// The common frame for the app's pages: a top ad banner, the page content, a
// right-hand ad column on desktop (below the content on small screens) and a
// bottom banner. Everything is in normal flow, so ads never sit on top of the
// page's controls, and the content column can shrink (`min-w-0`) so nothing
// forces horizontal scrolling at phone widths.

import { AdBottom, AdSide, AdTop } from "@/components/ads/AdSlot";

export function PageShell({
  children,
  width = "wide",
  side = true,
}: {
  children: React.ReactNode;
  // "wide" leaves room for the right-hand ad column; "narrow" is a single column.
  width?: "wide" | "narrow";
  side?: boolean;
}) {
  const withSide = side && width === "wide";
  return (
    <main className={`mx-auto w-full flex-1 px-4 py-6 ${width === "wide" ? "max-w-6xl" : "max-w-3xl"}`}>
      <AdTop className="mb-6" />
      <div className={withSide ? "lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8" : ""}>
        <div className="min-w-0">{children}</div>
        {withSide && <AdSide className="mt-8 lg:sticky lg:top-20 lg:mt-0" />}
      </div>
      <AdBottom className="mt-8" />
    </main>
  );
}

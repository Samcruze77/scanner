// When each public page's CONTENT last changed in a way a reader would notice, for the
// sitemap's <lastmod>. Google and Bing use lastmod to decide what to recrawl, but only
// while it stays trustworthy: a date that is always "now" (what the sitemap used to send)
// is learned to be meaningless and ignored. So:
//
//  - bump a page's date here when its text, title or tool really changes (not for a
//    refactor, a style tweak or a dependency upgrade);
//  - guides carry their own `updated` date in utils/seo/guides.ts;
//  - everything not listed uses CONTENT_BASELINE, the last site-wide content change.

export const CONTENT_BASELINE = "2026-11-14";

const PAGE_UPDATED: Record<string, string> = {
  "/": "2026-11-25",
  "/scan": "2026-11-24",
  "/guides": "2026-11-24",
  "/tools/protect-pdf": "2026-11-24",
  "/convert/pdf-to-word": "2026-11-24",
  "/convert/excel-to-pdf": "2026-11-24",
  "/tools/compress-pdf": "2026-11-24",
  "/convert/pdf-to-jpg": "2026-11-25",
  "/convert/pdf-to-png": "2026-11-25",
  "/convert": "2026-11-25",
  "/pdf-converter": "2026-11-25",
  "/privacy": "2026-10-26",
};

export function pageUpdated(path: string): string {
  return PAGE_UPDATED[path] ?? CONTENT_BASELINE;
}

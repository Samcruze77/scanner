// Builds the <head> metadata for a public page, so every page gets the same complete,
// consistent set: a unique title and description, its own canonical address, and
// matching Open Graph / X (Twitter) previews with the branded share image.

import type { Metadata } from "next";
import { SITE_NAME } from "./site";

// The branded 1200x630 share image (app/og/route.tsx).
export const SHARE_IMAGE = { url: "/og", width: 1200, height: 630, alt: "FreePDFScanner: free online PDF scanner and document tools" };

// Search results show about 60 characters of a title. The site name is added when it fits; a longer
// title keeps its own words (they are what people search for) and goes without it.
export const TITLE_LIMIT = 60;

export function brandedTitle(title: string): string {
  if (title.includes(SITE_NAME)) return title;
  const withName = `${title} | ${SITE_NAME}`;
  return withName.length <= TITLE_LIMIT ? withName : title;
}

interface PageMeta {
  // The page's own title, written for search results. The site name is added when it fits (brandedTitle).
  title: string;
  description: string;
  // Site path, e.g. "/tools/compress-pdf". Used for the canonical URL and og:url.
  path: string;
  // A complete title used exactly as written (the home page, whose title starts with the brand).
  absoluteTitle?: string;
  // Keeps a page usable but out of search results.
  noindex?: boolean;
  type?: "website" | "article";
}

export function pageMetadata({ title, description, path, absoluteTitle, noindex, type = "website" }: PageMeta): Metadata {
  const fullTitle = absoluteTitle ?? brandedTitle(title);
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: path },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type,
      siteName: SITE_NAME,
      locale: "en_US",
      title: fullTitle,
      description,
      url: path,
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [SHARE_IMAGE.url],
    },
  };
}

// For private or application-only pages: never indexed, links not followed.
export function privateMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
  };
}

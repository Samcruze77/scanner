// Served at /robots.txt. Everything public and useful stays crawlable, including the
// static asset directories (OCR engine, PDF.js runtime, fonts) that pages need Google to
// fetch in order to render them correctly -- blocking those would hurt indexing, not
// help it. Only the admin area (its own server-side auth check, and no content a search
// engine should ever show) is disallowed; the other non-public page (/history) relies on
// its own noindex tag instead, so it can still be crawled and the tag can be read (a
// hard Disallow would hide the tag, not just the content).
//
// Only the real production deployment publishes an open robots.txt: a Vercel preview or
// local build disallows everything, so a preview URL is never indexed by mistake.

import type { MetadataRoute } from "next";
import { getSiteUrl, isIndexableDeployment } from "@/utils/seo/site";

export default function robots(): MetadataRoute.Robots {
  if (!isIndexableDeployment()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/admin/"] }],
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}

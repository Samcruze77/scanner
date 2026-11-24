// Served at /sitemap.xml. Lists only canonical, public, indexable URLs -- built from the
// same tool registry and converter list the app itself uses, so it can't drift out of
// sync with the real routes. Left out on purpose: the admin area, the account-only
// history page, the password-reset page, and the near-duplicate tool pages that
// canonicalize elsewhere (see utils/seo/toolCanonicals.ts) -- none of those should be
// what a search engine is pointed at.
//
// <lastmod> is the date the page's content really changed (utils/seo/updated.ts, and each
// guide's own `updated` date), never the time of the request: a lastmod that is always
// "now" teaches search engines to ignore it.

import type { MetadataRoute } from "next";
import { CONVERT_TOOLS } from "@/components/convert/tools";
import { TOOLS } from "@/utils/tools/registry";
import { GUIDES } from "@/utils/seo/guides";
import { KEYWORD_PATHS } from "@/utils/seo/landing";
import { getSiteUrl } from "@/utils/seo/site";
import { TOOL_CANONICAL_OVERRIDE } from "@/utils/seo/toolCanonicals";
import { pageUpdated } from "@/utils/seo/updated";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const url = (path: string, priority: number, lastModified = pageUpdated(path)): MetadataRoute.Sitemap[number] => ({
    url: `${base}${path}`,
    lastModified,
    priority,
  });

  const entries: MetadataRoute.Sitemap = [url("/", 1), url("/scan", 0.9), url("/tools", 0.8), url("/convert", 0.8)];
  // Keyword-specific landing pages that point into the tools above (see
  // utils/seo/landing.ts) -- not redirects, so they're indexed in their own
  // right; the pure-alias routes (e.g. /pdf-to-word) are real 301s in
  // next.config.ts's redirects() and are deliberately not listed here, since
  // the target they redirect to is already in this sitemap.
  for (const path of KEYWORD_PATHS) entries.push(url(path, 0.6));
  for (const tool of CONVERT_TOOLS) entries.push(url(tool.href, 0.7));
  for (const tool of TOOLS) {
    if (TOOL_CANONICAL_OVERRIDE[tool.slug]) continue;
    entries.push(url(`/tools/${tool.slug}`, 0.7));
  }
  entries.push(url("/privacy", 0.3));
  // The hub changes whenever a guide is added or updated.
  const newestGuide = GUIDES.map((g) => g.updated).sort().at(-1);
  entries.push(url("/guides", 0.5, [pageUpdated("/guides"), newestGuide ?? ""].sort().at(-1)));
  for (const guide of GUIDES) entries.push(url(`/guides/${guide.slug}`, 0.5, guide.updated));
  return entries;
}

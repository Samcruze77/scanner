// Served at /sitemap.xml. Lists only canonical, public, indexable URLs -- built from the
// same tool registry and converter list the app itself uses, so it can't drift out of
// sync with the real routes. Left out on purpose: the admin area, the account-only
// history page, the password-reset page, and the near-duplicate tool pages that
// canonicalize elsewhere (see utils/seo/toolCanonicals.ts) -- none of those should be
// what a search engine is pointed at.

import type { MetadataRoute } from "next";
import { CONVERT_TOOLS } from "@/components/convert/tools";
import { TOOLS } from "@/utils/tools/registry";
import { GUIDES } from "@/utils/seo/guides";
import { getSiteUrl } from "@/utils/seo/site";
import { TOOL_CANONICAL_OVERRIDE } from "@/utils/seo/toolCanonicals";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const url = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: `${base}${path}`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority,
  });

  const entries: MetadataRoute.Sitemap = [url("/", 1), url("/scan", 0.9), url("/tools", 0.8), url("/convert", 0.8)];
  for (const tool of CONVERT_TOOLS) entries.push(url(tool.href, 0.7));
  for (const tool of TOOLS) {
    if (TOOL_CANONICAL_OVERRIDE[tool.slug]) continue;
    entries.push(url(`/tools/${tool.slug}`, 0.7));
  }
  entries.push(url("/guides", 0.5));
  for (const guide of GUIDES) entries.push(url(`/guides/${guide.slug}`, 0.5));
  return entries;
}

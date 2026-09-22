// Some entries in the Tools menu (see utils/tools/registry.ts) are the same editor
// opened with a different tool preselected -- useful as distinct entry points for
// someone who searches for exactly that action, but near-duplicates of each other and
// of the fuller page underneath them. Rather than index eight thin, near-identical
// pages, each one's canonical URL points at the page that actually covers it, so search
// engines consolidate on one good result instead of splitting relevance across many
// (and the sitemap lists only the canonical target, not the alias).
//
// The page itself is unchanged either way: still live, still fully usable, still linked
// from the Tools hub. This only affects which URL a search engine is told to prefer.
export const TOOL_CANONICAL_OVERRIDE: Record<string, string> = {
  "add-text": "/tools/annotate",
  draw: "/tools/annotate",
  highlight: "/tools/annotate",
  "add-date": "/tools/annotate",
  checkmark: "/tools/annotate",
  "x-mark": "/tools/annotate",
  "add-signature": "/tools/sign-pdf",
  "upload-signature": "/tools/sign-pdf",
};

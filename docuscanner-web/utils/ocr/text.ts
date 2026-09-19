import type { OcrPageResult } from "./types";

export function normalizeOcrText(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Engines invent stray punctuation from blank pages, textures and edges.
  // With no letter or digit anywhere there is nothing worth keeping.
  return /[\p{L}\p{N}]/u.test(text) ? text : "";
}

// Single page: just its text. Multiple pages: each page's text under a
// "--- Page N ---" line, in document order.
export function combinePageText(pages: OcrPageResult[]): string {
  if (pages.length === 1) return pages[0].text;
  return pages.map((page) => `--- Page ${page.pageNumber} ---\n${page.text}`).join("\n\n");
}

export interface TextMatch {
  start: number;
  end: number;
}

// Cap keeps a one-letter query on a long document from rendering thousands
// of highlights.
export const MAX_SEARCH_MATCHES = 500;

// Literal, case-insensitive search. Uses a regex (not lowercase + indexOf)
// so offsets always refer to the original string.
export function findMatches(text: string, query: string): TextMatch[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const matches: TextMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined || match[0].length === 0) continue;
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length >= MAX_SEARCH_MATCHES) break;
  }
  return matches;
}

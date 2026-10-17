// The built-in guide: finds the help entries that fit a question and turns them
// into step-by-step instructions. It is plain keyword matching over the product
// knowledge (utils/assistant/knowledge.ts), not an AI model, and the interface
// says so. It is used when the AI model is switched off or unavailable, and the
// same ranking picks which entries the AI is shown.

import { describePage, ENTRY_LIST, stepsFor, suggestionsFor, type HelpEntry, type HelpStep } from "./knowledge.ts";

const STOPWORDS = new Set([
  "a", "an", "the", "i", "me", "my", "we", "you", "your", "to", "do", "does", "can", "could", "how", "what", "where", "when",
  "is", "are", "it", "of", "in", "on", "for", "and", "or", "with", "this", "that", "please", "want", "need", "would", "like",
  "help", "get", "make", "use", "should", "will", "there", "be", "any", "so", "if", "at", "by", "from", "about", "into",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem);
}

export interface RankedEntry {
  entry: HelpEntry;
  score: number;
}

// A phrase that appears in the question counts for more the longer it is; loose
// word overlap counts for a little. A page the visitor is on nudges its own
// topics up, never past a clear match for something else.
export function rankEntries(query: string, pathname: string, limit = 3): RankedEntry[] {
  const q = normalize(query);
  if (!q) return [];
  const qList = tokens(q);
  const qTokens = new Set(qList);
  // Phrases are compared without filler words ("split a pdf" matches "split pdf").
  const qSeq = ` ${qList.join(" ")} `;
  const path = describePage(pathname).path;

  const ranked = ENTRY_LIST.map((entry): RankedEntry => {
    let score = 0;
    for (const phrase of entry.keywords) {
      const words = tokens(phrase);
      // A multi-word phrase that shrinks to one generic word ("where is my pdf") proves nothing.
      const meaningful = words.length >= 2 || (words.length === 1 && normalize(phrase).split(" ").length === 1);
      if (meaningful && qSeq.includes(` ${words.join(" ")} `)) score += 3 + words.length * 1.5;
    }
    const vocabulary = new Set([...entry.keywords.flatMap(tokens), ...tokens(entry.title)]);
    for (const t of qTokens) if (vocabulary.has(t)) score += 1;
    if (score > 0) {
      if (entry.route === path) score += 1.5;
      if (entry.variants?.some((v) => v.pages.includes(path))) score += 1;
    }
    return { entry, score };
  })
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, limit);
}

export interface GuideLink {
  href: string;
  label: string;
}

export interface GuideAnswer {
  // True when something in the knowledge base matched.
  matched: boolean;
  intro: string;
  steps: HelpStep[];
  notes: string[];
  links: GuideLink[];
  entryIds: string[];
  // The steps were written for the page the visitor is on.
  onThisPage: boolean;
}

export function linksFor(entries: readonly HelpEntry[]): GuideLink[] {
  const seen = new Set<string>();
  const links: GuideLink[] = [];
  for (const e of entries) {
    if (e.route && !seen.has(e.route)) {
      seen.add(e.route);
      links.push({ href: e.route, label: e.routeLabel ?? e.title });
    }
  }
  return links;
}

export function buildGuideAnswer(query: string, pathname: string): GuideAnswer {
  const ranked = rankEntries(query, pathname, 3);
  if (ranked.length === 0) {
    return {
      matched: false,
      intro:
        "I'm not sure I have that. I can help with scanning, converting Word, Excel and images to PDF, editing and signing, adding pictures, compressing, text recognition and password protection. Try one of these questions, or browse all the tools.",
      steps: [],
      notes: [],
      links: [
        { href: "/tools", label: "See all tools" },
        { href: "/convert", label: "See all converters" },
        { href: "/scan", label: "Open Scan" },
      ],
      entryIds: [],
      onThisPage: false,
    };
  }
  const top = ranked[0].entry;
  const { steps, onThisPage } = stepsFor(top, pathname);
  const here = describePage(pathname);
  const intro = onThisPage
    ? `${top.summary} You're already on ${here.label}, so here is what to do on this page:`
    : steps.length
      ? `${top.summary} Here's how:`
      : top.summary;
  // Other topics the question clearly also touched, as extra links only (weak matches are left out).
  const others = ranked.slice(1).filter((r) => r.score >= ranked[0].score * 0.7).map((r) => r.entry);
  return {
    matched: true,
    intro,
    steps,
    notes: top.notes ?? [],
    links: linksFor([top, ...others]),
    entryIds: ranked.map((r) => r.entry.id),
    onThisPage,
  };
}

export { suggestionsFor };

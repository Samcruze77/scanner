// Cleans text the AI model wrote before it is shown or stored, and checks what
// a visitor typed before it is sent. The model is told to use only the routes in
// the knowledge base; this makes sure an invented page never reaches the screen
// as if it were real.

import { isKnownRoute } from "./knowledge.ts";

export const MAX_QUESTION_CHARS = 500;
export const MAX_HISTORY_TURNS = 6;
export const MAX_ANSWER_CHARS = 1800;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatTurn[];
  // Where the visitor is. A path only: no query string, no document data.
  path: string;
}

export type ValidationResult = { ok: true; value: ChatRequest } | { ok: false; reason: string };

// Phone numbers, card-like numbers and e-mail addresses are not needed to answer a
// "where is the button" question, so they are removed before anything is sent on.
export function scrub(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[number removed]")
    .replace(/\b\+?\d[\d\s().-]{8,}\d\b/g, "[number removed]");
}

export function validateChatRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") return { ok: false, reason: "bad_request" };
  const { messages, path } = body as { messages?: unknown; path?: unknown };
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) return { ok: false, reason: "bad_messages" };
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") return { ok: false, reason: "bad_messages" };
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return { ok: false, reason: "bad_messages" };
    if (content.length > MAX_QUESTION_CHARS * 4) return { ok: false, reason: "too_long" };
    turns.push({ role, content: content.trim() });
  }
  const last = turns[turns.length - 1];
  if (last.role !== "user" || last.content === "") return { ok: false, reason: "bad_messages" };
  if (last.content.length > MAX_QUESTION_CHARS) return { ok: false, reason: "too_long" };
  const cleanPath = typeof path === "string" && /^\/[a-z0-9/_-]{0,80}$/i.test(path.split("?")[0]) ? path.split("?")[0] : "/";
  // Only the last few turns are kept, and each is scrubbed.
  const kept = turns.slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, content: scrub(t.content.slice(0, MAX_QUESTION_CHARS)) }));
  // The conversation must start with a user turn.
  while (kept.length > 0 && kept[0].role !== "user") kept.shift();
  return { ok: true, value: { messages: kept, path: cleanPath } };
}

// Strips markup and links from a model answer and removes anything that looks
// like a page of this site that does not exist.
export function sanitizeAnswer(raw: string): string {
  let text = raw
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]*|\/[^)]*)\)/g, "$1")
    .replace(/https?:\/\/(?!(?:www\.)?freepdfscanner\.com)\S+/gi, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "");
  // Internal paths such as /tools/foo: keep known ones, drop invented ones.
  text = text.replace(/(^|[\s(])(\/[a-z0-9][a-z0-9/_-]*)/gi, (match, lead: string, route: string) => {
    const clean = route.replace(/[.,;:!?)]+$/, "");
    return isKnownRoute(clean) ? match : lead;
  });
  text = text.replace(/\s{3,}/g, "  ").trim();
  if (text.length > MAX_ANSWER_CHARS) text = text.slice(0, MAX_ANSWER_CHARS).replace(/\s+\S*$/, "") + "...";
  return text;
}

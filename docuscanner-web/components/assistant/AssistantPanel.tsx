"use client";

// The "Ask FreePDFScanner" chat panel. Loaded only after the launcher is pressed.
//
// Two ways to answer, and the panel is honest about which one is in use:
//  - AI answers: the question, a few earlier turns and the page path go to
//    /api/assistant, which asks the model using only the verified product knowledge.
//  - Built-in guide: if the model is off, unavailable or rate-limited, a keyword search
//    over the same knowledge answers instead. It is labelled as automatic help, not AI.
//
// Never sent: documents, filenames, passwords, tokens. The chat lives in memory only and
// is gone when the tab closes. The assistant only explains; it never clicks, submits,
// downloads or navigates by itself. Links to other pages open in a new tab while the
// visitor is in the middle of a document, so nothing is lost.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { trackFeatureUsed } from "@/utils/analytics/events";
import { buildGuideAnswer, suggestionsFor, type GuideAnswer, type GuideLink } from "@/utils/assistant/guide";
import { findTarget, highlightTarget } from "@/utils/assistant/highlight";
import { describePage, getEntry, stepsFor, type HelpStep } from "@/utils/assistant/knowledge";
import { MAX_QUESTION_CHARS } from "@/utils/assistant/sanitize";
import { Icon } from "@/components/ui/icons";

type AiState = "unknown" | "on" | "off";

interface UserMessage {
  id: number;
  role: "user";
  text: string;
}

interface AssistantMessage {
  id: number;
  role: "assistant";
  // "ai": written by the model. "guide": the built-in keyword guide. "plain": a system line.
  mode: "ai" | "guide" | "plain";
  text?: string;
  guide?: GuideAnswer;
  links?: GuideLink[];
  entryIds?: string[];
  // Why the built-in guide answered instead of the AI, shown under the answer.
  notice?: string;
  // The question to send to the AI again, when the failure may be temporary.
  retry?: string;
  pathAtAnswer?: string;
}

type Message = UserMessage | AssistantMessage;

const WELCOME =
  "Hi! I'm your FreePDFScanner guide. Ask me how to convert, edit, protect, or download a document, and I'll show you where to go.";

let nextId = 1;

function isWorkflowPath(pathname: string): boolean {
  const { area, path } = describePage(pathname);
  return (area === "scan" || area === "tool" || area === "convert") && path !== "/tools" && path !== "/convert";
}

export function AssistantPanel({ open, pathname, onClose }: { open: boolean; pathname: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiState, setAiState] = useState<AiState>("unknown");
  const [pointNotes, setPointNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const openedOnce = useRef(false);
  const requestRef = useRef(0);

  const page = describePage(pathname);
  const suggestions = suggestionsFor(pathname);
  const workflow = isWorkflowPath(pathname);

  // First opening: say hello and find out whether the AI is switched on, so the panel
  // never presents the built-in guide as an AI.
  useEffect(() => {
    if (!open || openedOnce.current) return;
    openedOnce.current = true;
    void trackFeatureUsed("assistant_opened");
    let cancelled = false;
    fetch("/api/assistant", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ai?: boolean } | null) => {
        if (!cancelled && data) setAiState(data.ai ? "on" : "off");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy, open]);

  function push(message: Omit<UserMessage, "id"> | Omit<AssistantMessage, "id">) {
    setMessages((prev) => [...prev, { ...message, id: nextId++ } as Message]);
  }

  function answerWithGuide(question: string, notice?: string, retry?: string) {
    const guide = buildGuideAnswer(question, pathname);
    push({ role: "assistant", mode: "guide", guide, links: guide.links, entryIds: guide.entryIds, notice, retry, pathAtAnswer: pathname });
  }

  function historyFor(question: string): { role: "user" | "assistant"; content: string }[] {
    const turns: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of messages) {
      if (m.role === "user") turns.push({ role: "user", content: m.text });
      else if (m.text) turns.push({ role: "assistant", content: m.text });
      else if (m.guide) turns.push({ role: "assistant", content: m.guide.intro });
    }
    turns.push({ role: "user", content: question });
    return turns;
  }

  async function ask(raw: string, alreadyShown = false) {
    const question = raw.trim().slice(0, MAX_QUESTION_CHARS);
    if (!question || busy) return;
    if (!alreadyShown) push({ role: "user", text: question });
    setInput("");
    void trackFeatureUsed("assistant_question", { mode: aiState === "off" ? "guide" : "ai_attempt" });

    if (aiState === "off") {
      answerWithGuide(question, "The AI helper isn't switched on for this site, so this is the built-in guide: automatic keyword help, not AI.");
      return;
    }

    const requestId = ++requestRef.current;
    setBusy(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: historyFor(question), path: pathname }),
      });
      if (requestId !== requestRef.current) return;
      if (response.ok) {
        const data = (await response.json()) as { answer: string; entryIds: string[]; links: GuideLink[] };
        setAiState("on");
        push({ role: "assistant", mode: "ai", text: data.answer, links: data.links, entryIds: data.entryIds, pathAtAnswer: pathname });
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; reason?: string; retryAfter?: number };
      if (response.status === 429) {
        const wait = data.retryAfter && data.retryAfter < 3600 ? ` Try the AI again in about ${Math.max(1, Math.ceil(data.retryAfter))} seconds.` : "";
        answerWithGuide(question, `You're asking quickly, so the AI helper needs a short rest.${wait} Here is the built-in guide meanwhile (automatic keyword help, not AI).`, question);
      } else if (data.reason === "not_configured" || data.reason === "disabled") {
        setAiState("off");
        answerWithGuide(question, "The AI helper isn't switched on for this site, so this is the built-in guide: automatic keyword help, not AI.");
      } else {
        answerWithGuide(question, "The AI helper isn't available right now. This is the built-in guide instead (automatic keyword help, not AI).", question);
      }
    } catch {
      if (requestId !== requestRef.current) return;
      answerWithGuide(question, "I couldn't reach the AI helper. This is the built-in guide instead (automatic keyword help, not AI).", question);
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  }

  function retry(question: string) {
    // Replaces nothing: asks again and appends the new answer.
    void ask(question, true);
  }

  function point(target: string, key: string) {
    const note = (text: string) => setPointNotes((prev) => ({ ...prev, [key]: text }));
    if (!findTarget(target)) {
      note("I can't see that on this screen right now. It may appear after an earlier step, or this page may have changed. Follow the written steps instead.");
      return;
    }
    const compact = window.matchMedia("(max-width: 639px)").matches;
    const run = () => note(highlightTarget(target) ? "Highlighted on the page." : "I couldn't point at that. Follow the written steps instead.");
    if (compact) {
      // The panel covers most of a phone's screen; step aside so the control is visible.
      onClose();
      requestAnimationFrame(() => requestAnimationFrame(run));
    } else {
      run();
    }
  }

  function toggleSteps(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderSteps(steps: HelpStep[], keyPrefix: string) {
    return (
      <ol className="mt-2 space-y-2">
        {steps.map((step, index) => {
          const key = `${keyPrefix}-${index}`;
          return (
            <li key={key} className="flex gap-2 text-sm leading-5">
              <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block">{step.text}</span>
                {step.target && (
                  <button
                    type="button"
                    onClick={() => point(step.target as string, key)}
                    className="mt-1 inline-flex min-h-9 items-center rounded-md border border-blue-600 px-2 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950"
                  >
                    Show me on this page
                  </button>
                )}
                {pointNotes[key] && (
                  <span role="status" className="muted mt-1 block text-xs">
                    {pointNotes[key]}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  function renderLinks(links: GuideLink[] | undefined) {
    const shown = (links ?? []).filter((l) => l.href !== describePage(pathname).path);
    if (shown.length === 0) return null;
    return (
      <div className="mt-3">
        <p className="muted text-xs font-medium">Go to</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {shown.map((link) => (
            <li key={link.href}>
              {workflow ? (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex min-h-9 items-center gap-1 rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {link.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <Link href={link.href} className="inline-flex min-h-9 items-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700">
                  {link.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
        {workflow && <p className="muted mt-1 text-xs">Links open in a new tab so your work on this page isn&apos;t lost.</p>}
      </div>
    );
  }

  function renderAssistant(m: AssistantMessage) {
    if (m.mode === "plain") return <p className="text-sm leading-5">{m.text}</p>;
    if (m.mode === "ai") {
      const top = m.entryIds?.map(getEntry).find((e) => e && (e.steps?.length ?? 0) > 0);
      const guided = top ? stepsFor(top, m.pathAtAnswer ?? pathname).steps : [];
      const isOpen = expanded.has(m.id);
      return (
        <>
          <p className="whitespace-pre-line text-sm leading-5">{m.text}</p>
          {guided.length > 0 && (
            <div className="mt-2">
              <button type="button" aria-expanded={isOpen} onClick={() => toggleSteps(m.id)} className="min-h-9 text-sm font-medium text-blue-700 underline dark:text-blue-300">
                {isOpen ? "Hide the checked steps" : "Show checked steps with pointers"}
              </button>
              {isOpen && renderSteps(guided, `ai-${m.id}`)}
            </div>
          )}
          {renderLinks(m.links)}
          <p className="muted mt-2 text-xs">AI-written answer. It can be wrong, so check it against the page.</p>
        </>
      );
    }
    const g = m.guide as GuideAnswer;
    return (
      <>
        <p className="text-sm leading-5">{g.intro}</p>
        {g.steps.length > 0 && renderSteps(g.steps, `g-${m.id}`)}
        {g.notes.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5">
            {g.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {renderLinks(m.links)}
        {!g.matched && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {suggestions.slice(0, 3).map((s) => (
              <li key={s.text}>
                <button type="button" onClick={() => void ask(s.text)} className="min-h-9 rounded-full border border-zinc-300 px-3 text-xs dark:border-zinc-700">
                  {s.text}
                </button>
              </li>
            ))}
          </ul>
        )}
        {m.notice && <p className="muted mt-3 text-xs">{m.notice}</p>}
        {m.retry && (
          <button type="button" onClick={() => retry(m.retry as string)} disabled={busy} className="mt-2 min-h-9 rounded-md border border-zinc-300 px-3 text-xs font-medium disabled:opacity-50 dark:border-zinc-700">
            Try the AI again
          </button>
        )}
      </>
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  const badge =
    aiState === "on"
      ? "AI helper. Answers can be wrong; check them on the page."
      : aiState === "off"
        ? "Built-in guide (automatic keyword help, not AI)."
        : "Help for finding tools and doing tasks.";

  return (
    <div
      role="dialog"
      aria-label="Ask FreePDFScanner"
      aria-modal="false"
      hidden={!open}
      id="assistant-panel"
      data-assistant-panel
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="fixed inset-x-2 bottom-[calc(7.25rem+env(safe-area-inset-bottom))] z-[80] flex h-[min(34rem,calc(100dvh-10.5rem))] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-surface shadow-2xl sm:inset-x-auto sm:bottom-16 sm:right-3 sm:w-[24rem] dark:border-zinc-700"
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Ask FreePDFScanner</h2>
          <p className="muted text-xs">{badge}</p>
          <p className="muted text-xs">You&apos;re on: {page.label}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the help assistant" className="btn btn-icon btn-ghost shrink-0">
          <span aria-hidden className="text-lg leading-none">
            ×
          </span>
        </button>
      </div>

      <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-hover px-3 py-2">
          <p className="text-sm leading-5">{WELCOME}</p>
        </div>

        {messages.length === 0 && (
          <div>
            <p className="muted mb-2 text-xs font-medium">Try asking</p>
            <ul className="flex flex-col gap-2">
              {suggestions.map((s) => (
                <li key={s.text}>
                  <button
                    type="button"
                    onClick={() => void ask(s.text)}
                    disabled={busy}
                    className="min-h-11 w-full rounded-xl border border-zinc-300 px-3 py-2 text-left text-sm hover:bg-hover disabled:opacity-50 dark:border-zinc-700"
                  >
                    {s.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2 text-sm leading-5 text-white">
              <span className="sr-only">You: </span>
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="max-w-[96%] rounded-2xl rounded-tl-sm bg-hover px-3 py-2">
              <span className="sr-only">Assistant: </span>
              {renderAssistant(m)}
            </div>
          ),
        )}

        {busy && (
          <div role="status" className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Icon name="info" size={16} />
            Thinking&hellip;
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <label htmlFor="assistant-input" className="sr-only">
          Ask a question about FreePDFScanner
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="assistant-input"
            ref={inputRef}
            value={input}
            maxLength={MAX_QUESTION_CHARS}
            rows={1}
            placeholder="Ask how to do something"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            className="max-h-24 min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-zinc-300 bg-surface px-3 py-2.5 text-sm dark:border-zinc-700"
          />
          <button type="submit" disabled={busy || input.trim() === ""} className="btn btn-primary min-h-11 shrink-0 px-4">
            Send
          </button>
        </div>
        <p className="muted mt-2 text-[11px] leading-4">
          Please don&apos;t type passwords or personal details. Your documents are never sent here. This chat is kept only in this browser tab.
        </p>
      </form>
    </div>
  );
}

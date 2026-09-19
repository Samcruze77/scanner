"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { findMatches } from "@/utils/ocr/text";

const BUTTON = "min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700";

// Editable extracted text with select-all, download and in-text search. While
// a search is active the text is shown read-only with highlighted matches
// (a textarea can't highlight and can't scroll to a match without raising the
// mobile keyboard); clearing the search returns to editing.
export function OcrTextEditor({
  text,
  edited,
  onTextChange,
  onRestore,
  onDownload,
  onDiscard,
}: {
  text: string;
  edited: boolean;
  onTextChange: (text: string) => void;
  onRestore: () => void;
  onDownload: () => void;
  onDiscard: () => void;
}) {
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const currentMarkRef = useRef<HTMLElement>(null);

  const searching = query.trim().length > 0;
  const matches = useMemo(() => (searching ? findMatches(text, query) : []), [searching, text, query]);
  const current = matches.length > 0 ? matchIndex % matches.length : -1;

  const segments = useMemo(() => {
    const out: { text: string; match: number }[] = [];
    let position = 0;
    matches.forEach((m, i) => {
      if (m.start > position) out.push({ text: text.slice(position, m.start), match: -1 });
      out.push({ text: text.slice(m.start, m.end), match: i });
      position = m.end;
    });
    if (position < text.length) out.push({ text: text.slice(position), match: -1 });
    return out;
  }, [matches, text]);

  useEffect(() => {
    currentMarkRef.current?.scrollIntoView({ block: "center" });
  }, [current, query]);

  function step(delta: number) {
    if (matches.length === 0) return;
    setMatchIndex((index) => (index + delta + matches.length) % matches.length);
  }

  function selectAll() {
    if (searching && resultsRef.current) {
      window.getSelection()?.selectAllChildren(resultsRef.current);
      return;
    }
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }

  function discard() {
    if (edited && !window.confirm("Discard the extracted text and your edits?")) return;
    onDiscard();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={selectAll} className={BUTTON}>
          Select all
        </button>
        <button type="button" onClick={onDownload} disabled={text.length === 0} className={`${BUTTON} disabled:opacity-50`}>
          Download .txt
        </button>
        {edited && (
          <button type="button" onClick={onRestore} className={BUTTON}>
            Undo edits
          </button>
        )}
        <button
          type="button"
          onClick={discard}
          className="min-h-11 rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
        >
          Discard
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMatchIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Search in text"
          aria-label="Search extracted text"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        />
        {searching && (
          <span role="status" className="whitespace-nowrap text-sm text-zinc-500">
            {matches.length === 0 ? "No matches" : `${current + 1} of ${matches.length}`}
          </span>
        )}
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={matches.length === 0}
          aria-label="Previous match"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-300 disabled:opacity-40 dark:border-zinc-700"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={matches.length === 0}
          aria-label="Next match"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-zinc-300 disabled:opacity-40 dark:border-zinc-700"
        >
          ↓
        </button>
      </div>

      {searching ? (
        <div
          ref={resultsRef}
          tabIndex={0}
          aria-label="Extracted text with search matches highlighted (clear the search to edit)"
          className="min-h-48 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-zinc-300 p-3 text-base leading-relaxed dark:border-zinc-700"
        >
          {segments.map((segment, i) =>
            segment.match === -1 ? (
              <span key={i}>{segment.text}</span>
            ) : (
              <mark
                key={i}
                ref={segment.match === current ? currentMarkRef : undefined}
                className={
                  segment.match === current
                    ? "rounded-sm bg-orange-300 text-black dark:bg-orange-500"
                    : "rounded-sm bg-yellow-200 text-black dark:bg-yellow-600/60 dark:text-white"
                }
              >
                {segment.text}
              </mark>
            ),
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          spellCheck={false}
          aria-label="Extracted text (editable)"
          className="min-h-48 w-full flex-1 resize-none rounded-md border border-zinc-300 bg-transparent p-3 text-base leading-relaxed dark:border-zinc-700"
        />
      )}
    </div>
  );
}

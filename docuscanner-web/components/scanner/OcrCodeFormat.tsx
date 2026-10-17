"use client";

// Optional tool in the extracted-text panel: fixes look-alike characters (0/O, 1/I) in codes whose format the
// person states. Nothing happens unless they type a format and press the button; ordinary text is never
// touched (see utils/ocr/identifiers.ts). "Undo edits" in the editor undoes it.

import { useState } from "react";
import { applyCodeFormat, isValidCodeFormat } from "@/utils/ocr/identifiers";

export function OcrCodeFormat({ text, onTextChange }: { text: string; onTextChange: (text: string) => void }) {
  const [pattern, setPattern] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const valid = isValidCodeFormat(pattern);

  function apply() {
    const result = applyCodeFormat(text, pattern);
    if (result.changed > 0) {
      onTextChange(result.text);
      setMessage(`Fixed ${result.changed} character${result.changed === 1 ? "" : "s"} in ${result.matched} code${result.matched === 1 ? "" : "s"}. "Undo edits" undoes this.`);
    } else {
      setMessage(result.matched > 0 ? `${result.matched} code${result.matched === 1 ? "" : "s"} already looked right.` : "No words with exactly that format were found, so nothing was changed.");
    }
  }

  return (
    <details className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800" data-assistant-id="ocr-code-format">
      <summary className="cursor-pointer font-medium">Fix look-alike characters in codes (optional)</summary>
      <div className="mt-2 space-y-2">
        <p className="muted text-xs leading-5">
          The reader sometimes mixes up 0 and O, or 1 and I, in codes. Both are valid characters, so nothing is changed unless you tell it the format of
          your codes: <strong>A</strong> is a letter, <strong>9</strong> is a digit, anything else is written as it is. For example <code>AAAA-A99</code>{" "}
          matches SCAN-L01. Only words of exactly that format are touched.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs font-medium">
            Format of your codes
            <input
              type="text"
              value={pattern}
              maxLength={40}
              onChange={(e) => {
                setPattern(e.target.value.trim());
                setMessage(null);
              }}
              placeholder="AAAA-A99"
              spellCheck={false}
              className="mt-1 block min-h-11 w-full rounded-lg border border-zinc-300 bg-surface px-3 text-sm font-normal dark:border-zinc-700"
            />
          </label>
          <button type="button" onClick={apply} disabled={!valid || text.length === 0} className="btn btn-secondary">
            Fix matching codes
          </button>
        </div>
        {message && (
          <p role="status" className="text-xs">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}

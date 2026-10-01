"use client";

// Start / End date picker for every admin report. Typing or picking a date only
// changes a draft; nothing is requested until Apply (or a preset) is pressed, so
// a half-typed year or a cleared field can never trigger a query or select a
// different period than the one shown. Ranges are UTC days, both inclusive.

import { useId, useState } from "react";
import { RANGE_TIMEZONE_LABEL, defaultDateRange, rangeDays, todayRange, validateRange } from "@/utils/admin/dateRange";
import type { DateRange } from "@/utils/admin/types";

const PRESETS: { label: string; range: () => DateRange }[] = [
  { label: "Today", range: todayRange },
  { label: "7 days", range: () => defaultDateRange(7) },
  { label: "30 days", range: () => defaultDateRange(30) },
  { label: "90 days", range: () => defaultDateRange(90) },
];

const field = "w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-800";

export function DateRangeControl({
  value,
  onApply,
  busy = false,
  presets = true,
}: {
  value: DateRange;
  onApply: (range: DateRange) => void;
  busy?: boolean;
  presets?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  // The applied range changed from outside (a preset, a URL): show it.
  if (seen.from !== value.from || seen.to !== value.to) {
    setSeen(value);
    setDraft(value);
  }

  const error = validateRange(draft);
  const unchanged = draft.from === value.from && draft.to === value.to;

  return (
    <form
      className="space-y-2"
      aria-label="Date range"
      onSubmit={(e) => {
        e.preventDefault();
        if (!error && !busy) onApply(draft);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {presets &&
          PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={busy}
              onClick={() => onApply(p.range())}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {p.label}
            </button>
          ))}
        <label className="text-sm" htmlFor={`${id}-from`}>
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Start date</span>
          <input
            id={`${id}-from`}
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            aria-invalid={!!error && !draft.from}
            className={field}
          />
        </label>
        <label className="text-sm" htmlFor={`${id}-to`}>
          <span className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">End date</span>
          <input
            id={`${id}-to`}
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            aria-invalid={!!error && !draft.to}
            className={field}
          />
        </label>
        <button
          type="submit"
          disabled={!!error || busy}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-black"
        >
          {busy ? "Loading…" : unchanged ? "Refresh" : "Apply"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {rangeDays(draft)} {rangeDays(draft) === 1 ? "day" : "days"}, both dates included. Days are {RANGE_TIMEZONE_LABEL}.
        </p>
      )}
    </form>
  );
}

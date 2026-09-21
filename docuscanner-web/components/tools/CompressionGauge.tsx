"use client";

// The compression level control: a five-step slider running from "Higher quality"
// to "Smaller file", and a summary of what the chosen step means for this file.
// The slider is a native range input (keyboard, screen reader and touch drag all
// work); the labels underneath are extra tap targets for the same steps.

import { COMPRESSION_LEVELS, formatBytes } from "@/utils/compress/types";

// Half of the slider thumb, so the labels line up with where the thumb stops.
const THUMB_INSET = 14;

// `undefined`: still estimating. `null`: no estimate can be made for this file.
export type LevelEstimate = number | null | undefined;

export function CompressionGauge({
  level,
  onLevelChange,
  originalBytes,
  estimate,
  disabled,
  locked,
}: {
  level: number;
  onLevelChange: (level: number) => void;
  originalBytes: number;
  estimate: LevelEstimate;
  disabled: boolean;
  // A target size is set, so the level is picked automatically.
  locked: boolean;
}) {
  const current = COMPRESSION_LEVELS[level];
  const last = COMPRESSION_LEVELS.length - 1;
  const inactive = disabled || locked;

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
          <span>Higher quality</span>
          <span>Smaller file</span>
        </div>
        <input
          type="range"
          className="compress-range"
          min={0}
          max={last}
          step={1}
          value={level}
          disabled={inactive}
          onChange={(e) => onLevelChange(Number(e.target.value))}
          aria-label="Compression level, from higher quality to smaller file"
          aria-valuetext={current.name}
        />
        <div className="relative -mt-2 h-11" aria-hidden="true">
          {COMPRESSION_LEVELS.map((l, i) => (
            <button
              key={l.key}
              type="button"
              tabIndex={-1}
              disabled={inactive}
              onClick={() => onLevelChange(i)}
              // The middle labels sit under the thumb's stops; the two end labels
              // are pinned to the edges so they never push the page wider.
              style={i === 0 ? { left: 0 } : i === last ? { right: 0 } : { left: `calc(${THUMB_INSET}px + (100% - ${THUMB_INSET * 2}px) * ${i / last})` }}
              className={`absolute top-0 flex h-11 min-w-11 items-center rounded-md px-1 text-xs disabled:cursor-not-allowed ${
                i === 0 ? "justify-start" : i === last ? "justify-end" : "-translate-x-1/2 justify-center"
              } ${i === level ? "font-semibold text-zinc-900 dark:text-white" : "text-zinc-500 dark:text-zinc-400"}`}
            >
              {l.short}
            </button>
          ))}
        </div>
      </div>

      {locked ? (
        <p role="status" className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          A target size is set under More options, so the level is chosen automatically: the lightest one that fits.
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" aria-live="polite">
          <div>
            <p className="text-sm font-semibold">{current.name}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{current.description}</p>
          </div>
          <Meters level={level} originalBytes={originalBytes} estimate={estimate} />
          {current.warning && (
            <p role="note" className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <span className="font-semibold">Quality warning: </span>
              {current.warning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Meters({ level, originalBytes, estimate }: { level: number; originalBytes: number; estimate: LevelEstimate }) {
  const current = COMPRESSION_LEVELS[level];
  const ratio = typeof estimate === "number" && originalBytes > 0 ? estimate / originalBytes : null;
  const sizeWidth = ratio === null ? 0 : Math.max(2, Math.min(100, Math.round(ratio * 100)));

  let sizeText: string;
  if (estimate === undefined) sizeText = "Estimating…";
  else if (estimate === null || ratio === null) sizeText = "Estimate not available for this file";
  else if (ratio >= 1) sizeText = `About ${formatBytes(estimate)}. Little or no reduction expected`;
  else if (ratio > 0.97) sizeText = `About ${formatBytes(estimate)}. Under 3% smaller, probably not worth it`;
  else sizeText = `About ${formatBytes(estimate)} (roughly ${Math.round((1 - ratio) * 100)}% smaller)`;

  return (
    <dl className="grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
      <dt className="text-zinc-600 dark:text-zinc-400">Current size</dt>
      <dd className="font-medium">{formatBytes(originalBytes)}</dd>

      <dt className="text-zinc-600 dark:text-zinc-400">File size</dt>
      <dd className="min-w-0">
        <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
          <div className="h-full rounded-full bg-sky-600 transition-[width] duration-200" style={{ width: `${sizeWidth}%` }} />
        </div>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">Estimate: </span>
          {sizeText}
        </p>
      </dd>

      <dt className="text-zinc-600 dark:text-zinc-400">Quality</dt>
      <dd className="min-w-0">
        <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ${level >= 3 ? "bg-amber-500" : "bg-emerald-600"}`}
            style={{ width: `${current.qualityMeter}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{current.qualityWord}</p>
      </dd>
    </dl>
  );
}

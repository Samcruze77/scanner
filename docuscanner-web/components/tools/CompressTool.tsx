"use client";

// Compress PDF / Image / Word / Excel. Pick a file, pick how hard to compress it
// on the quality <-> size slider (with an estimate of the result before anything
// runs), then see the exact before/after. Everything runs in the browser; the
// compression code itself loads only when it is needed.

import { useEffect, useState } from "react";
import { FileDropzone } from "@/components/convert/FileDropzone";
import { ErrorBanner } from "@/components/scanner/ErrorBanner";
import { PrintButton } from "@/components/print/PrintButton";
import { CompressionGauge, type LevelEstimate } from "@/components/tools/CompressionGauge";
import {
  trackCompressionCompleted,
  trackCompressionFailed,
  trackCompressionStarted,
  trackDocumentDownloaded,
  trackDocumentUploaded,
} from "@/utils/analytics/events";
import { COMPRESS_ACCEPT, validateCompressFile } from "@/utils/compress/browser";
import { compressErrorMessage } from "@/utils/compress/messages";
import { downloadBlob } from "@/utils/convert/download";
import { imageToPrintPages, pdfToPrintPages, printTitle } from "@/utils/print/sources";
import {
  COMPRESSION_LEVELS,
  CompressError,
  DEFAULT_LEVEL,
  formatBytes,
  MIN_TARGET_BYTES,
  TARGET_PRESETS,
  TINY_FILE_BYTES,
  type Analysis,
  type CompressKind,
  type CompressReport,
} from "@/utils/compress/types";

const KIND_COPY: Record<CompressKind, { title: string; hint: string; noun: string; help: string }> = {
  pdf: {
    title: "Choose a PDF",
    hint: "or drop it here. Text stays sharp and selectable; pictures inside are recompressed.",
    noun: "PDF",
    help: "Choose how much to shrink it. Scanned and photo-heavy PDFs shrink the most; a PDF that is mostly text is already small.",
  },
  image: {
    title: "Choose an image",
    hint: "or drop it here. JPG, PNG and WebP are supported.",
    noun: "image",
    help: "Slide toward a smaller file or better quality. You'll see the estimated size before anything is compressed.",
  },
  word: {
    title: "Choose a Word document",
    hint: "or drop it here. .docx files are supported.",
    noun: "document",
    help: "Only the pictures inside are shrunk. Your text, fonts and layout aren't touched.",
  },
  excel: {
    title: "Choose an Excel workbook",
    hint: "or drop it here. .xlsx files are supported.",
    noun: "workbook",
    help: "Only the pictures inside are shrunk. Formulas, sheets and formatting stay exactly as they are.",
  },
};

// `original` means "never resize"; a null cap (the default) lets the level decide.
const DIMENSIONS = [
  { value: "auto", label: "Set by the level" },
  { value: "original", label: "Keep original size" },
  { value: "3000", label: "Up to 3000 px" },
  { value: "2000", label: "Up to 2000 px" },
  { value: "1600", label: "Up to 1600 px" },
  { value: "1200", label: "Up to 1200 px" },
  { value: "800", label: "Up to 800 px" },
] as const;

const NEVER_RESIZE = 1_000_000;

function dimensionCap(kind: CompressKind, choice: string): number | null {
  if (kind !== "image" || choice === "auto") return null;
  return choice === "original" ? NEVER_RESIZE : Number(choice);
}

type Stage =
  | { name: "idle" }
  | { name: "ready"; file: File }
  | { name: "working"; file: File; label: string }
  | { name: "done"; file: File; report: CompressReport; strong: boolean };

// What reading the file (before compressing) turned up, tied to the file and size
// cap it was worked out for so a stale result is never shown for another file.
interface Estimates {
  file: File;
  maxDim: number | null;
  sizes: (number | null)[];
  analysis: Analysis | null;
  done: boolean;
}

function analyticsLevel(report: CompressReport): string {
  if (report.mode !== "level") return report.mode;
  return report.levelIndex === null ? "target" : COMPRESSION_LEVELS[report.levelIndex].key;
}

export function CompressTool({ kind }: { kind: CompressKind }) {
  const copy = KIND_COPY[kind];
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [targetChoice, setTargetChoice] = useState<string>("none");
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState<"KB" | "MB">("MB");
  const [dimension, setDimension] = useState<string>("auto");
  const [estimates, setEstimates] = useState<Estimates | null>(null);
  // Object URL of the compressed picture, so its quality can be checked by eye.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const activeFile = stage.name === "idle" ? null : stage.file;
  const maxDim = dimensionCap(kind, dimension);

  // Reads the file once it is chosen: refuses password-protected or damaged files
  // straight away, and works out the estimated size at each level.
  useEffect(() => {
    if (!activeFile) return;
    const file = activeFile;
    const signal = { aborted: false };
    void (async () => {
      try {
        const { analyzeFile } = await import("@/utils/compress/browser");
        const analysis = await analyzeFile({
          kind,
          file,
          maxDim,
          signal,
          onEstimate: (sizes) => {
            if (!signal.aborted) setEstimates((prev) => ({ file, maxDim, sizes, analysis: prev?.file === file ? prev.analysis : null, done: false }));
          },
        });
        if (signal.aborted) return;
        setEstimates({ file, maxDim, sizes: analysis?.estimates ?? [], analysis, done: true });
      } catch (err) {
        if (signal.aborted) return;
        const code = err instanceof CompressError ? err.code : "compress_failed";
        void trackCompressionFailed(kind, code);
        setError(compressErrorMessage(code));
        setStage({ name: "idle" });
      }
    })();
    return () => {
      signal.aborted = true;
    };
  }, [activeFile, kind, maxDim]);

  function resolveTarget(): { bytes: number | null } | { error: string } {
    if (targetChoice === "none") return { bytes: null };
    if (targetChoice === "custom") {
      const value = Number(customValue.replace(",", "."));
      const bytes = value * (customUnit === "MB" ? 1024 * 1024 : 1024);
      if (!Number.isFinite(value) || value <= 0 || bytes < MIN_TARGET_BYTES) {
        return { error: `Enter a size of at least ${Math.round(MIN_TARGET_BYTES / 1024)} KB.` };
      }
      return { bytes: Math.round(bytes) };
    }
    const preset = TARGET_PRESETS.find((p) => p.label === targetChoice);
    return { bytes: preset ? preset.bytes : null };
  }

  // Checks the type, size and real file signature straight away, so a renamed or
  // damaged file is refused with a clear message before any options are shown.
  async function choose(file: File) {
    setError(null);
    setPreviewUrl(null);
    setEstimates(null);
    try {
      validateCompressFile(kind, file, new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    } catch (err) {
      const code = err instanceof CompressError ? err.code : "compress_failed";
      void trackCompressionFailed(kind, code);
      setError(compressErrorMessage(code));
      setStage({ name: "idle" });
      return;
    }
    // Once per file chosen, however many times it is compressed afterwards.
    void trackDocumentUploaded(file.type || "application/octet-stream", file.size);
    setStage({ name: "ready", file });
  }

  async function run(file: File, strong: boolean) {
    const target = resolveTarget();
    if ("error" in target) {
      setError(target.error);
      return;
    }
    setError(null);
    setPreviewUrl(null);
    setStage({ name: "working", file, label: "Reading the file…" });
    const startedAt = Date.now();
    void trackCompressionStarted(kind, strong ? "flatten" : target.bytes !== null ? "target" : COMPRESSION_LEVELS[level].key);
    try {
      // The compression code (PDF writer, zip reader, codecs) loads only now.
      const { compressFile } = await import("@/utils/compress/browser");
      const report = await compressFile({
        kind,
        file,
        level,
        target: target.bytes,
        maxDim,
        strong,
        onProgress: (label) => setStage({ name: "working", file, label }),
      });
      void trackCompressionCompleted(kind, Date.now() - startedAt, report.meaningful ? report.reductionPct : 0, report.targetMet, analyticsLevel(report));
      if (kind === "image" && report.meaningful) {
        setPreviewUrl(URL.createObjectURL(new Blob([report.data as BlobPart], { type: report.mime })));
      }
      setStage({ name: "done", file, report, strong });
    } catch (err) {
      const code = err instanceof CompressError ? err.code : "compress_failed";
      void trackCompressionFailed(kind, code);
      setError(compressErrorMessage(code));
      setStage({ name: "idle" });
    }
  }

  function formatOf(mime: string): string {
    return kind === "image" ? mime.split("/")[1] : kind === "pdf" ? "pdf" : kind === "word" ? "docx" : "xlsx";
  }

  // The compressed file, or, when compression didn't help, the untouched original
  // (never a bigger or barely-smaller file presented as a win).
  function download(report: CompressReport) {
    downloadBlob(new Blob([report.data as BlobPart], { type: report.mime }), report.filename);
    void trackDocumentDownloaded(formatOf(report.mime));
  }

  const fieldBase = "min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-black";
  const field = `${fieldBase} w-full`;

  const locked = targetChoice !== "none";
  const current = activeFile && estimates?.file === activeFile && estimates.maxDim === maxDim ? estimates : null;
  const levelEstimate: LevelEstimate = current ? (current.sizes[level] ?? (current.done ? null : undefined)) : undefined;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {stage.name === "idle" && (
        <>
          <p className="text-sm text-zinc-500">{copy.help}</p>
          <FileDropzone accept={COMPRESS_ACCEPT[kind]} title={copy.title} hint={copy.hint} onFile={(file) => void choose(file)} />
        </>
      )}

      {(stage.name === "ready" || stage.name === "working") && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{stage.file.name}</p>
              <p className="text-xs text-zinc-500">{formatBytes(stage.file.size)}</p>
            </div>
            {stage.name === "ready" && (
              <button
                type="button"
                onClick={() => setStage({ name: "idle" })}
                className="min-h-11 rounded-md px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Choose a different file
              </button>
            )}
          </div>

          <fieldset disabled={stage.name === "working"} className="min-w-0 space-y-4">
            <legend className="mb-2 text-sm font-medium">Compression level</legend>
            <CompressionGauge
              level={level}
              onLevelChange={setLevel}
              originalBytes={stage.file.size}
              estimate={levelEstimate}
              disabled={stage.name === "working"}
              locked={locked}
            />

            <Notices kind={kind} noun={copy.noun} size={stage.file.size} analysis={current?.analysis ?? null} />

            <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-medium">
                <span>More options</span>
                <span className="text-xs font-normal text-zinc-500">{targetChoice !== "none" ? "Target size set" : kind === "image" ? "Target size, image size" : "Target size"}</span>
              </summary>
              <div className="space-y-4 border-t border-zinc-200 p-3 dark:border-zinc-800">
                <div>
                  <label htmlFor="compress-target" className="mb-1 block text-sm font-medium">
                    Aim for a specific size
                  </label>
                  <select id="compress-target" value={targetChoice} onChange={(e) => setTargetChoice(e.target.value)} className={field}>
                    <option value="none">No target (use the level above)</option>
                    {TARGET_PRESETS.map((p) => (
                      <option key={p.label} value={p.label}>
                        Under {p.label}
                      </option>
                    ))}
                    <option value="custom">Custom size…</option>
                  </select>
                  <p className="mt-1 text-xs text-zinc-500">We pick the lightest compression that fits. If it can&apos;t fit without wrecking quality, we say so.</p>
                  {targetChoice === "custom" && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label="Custom target size"
                        placeholder="e.g. 750"
                        value={customValue}
                        onChange={(e) => setCustomValue(e.target.value)}
                        className={`${field} min-w-0 flex-1`}
                      />
                      <select aria-label="Unit" value={customUnit} onChange={(e) => setCustomUnit(e.target.value as "KB" | "MB")} className={`${fieldBase} w-24 shrink-0`}>
                        <option>KB</option>
                        <option>MB</option>
                      </select>
                    </div>
                  )}
                </div>
                {kind === "image" && (
                  <div>
                    <label htmlFor="compress-dimension" className="mb-1 block text-sm font-medium">
                      Image size
                    </label>
                    <select id="compress-dimension" value={dimension} onChange={(e) => setDimension(e.target.value)} className={field}>
                      {DIMENSIONS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </details>
          </fieldset>

          {stage.name === "ready" ? (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => void run(stage.file, false)}
                className="min-h-11 w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white sm:w-auto dark:bg-white dark:text-black"
              >
                Compress {copy.noun}
              </button>
              <p className="text-xs text-zinc-500">Your original file is never changed. You download the compressed copy separately.</p>
            </div>
          ) : (
            <p role="status" className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500 dark:border-zinc-800">
              {stage.label}
            </p>
          )}
        </div>
      )}

      {stage.name === "done" && (
        <Result
          stage={stage}
          previewUrl={previewUrl}
          kind={kind}
          onDownload={download}
          onStrong={() => void run(stage.file, true)}
          onAgain={() => {
            setError(null);
            setPreviewUrl(null);
            setStage({ name: "ready", file: stage.file });
          }}
          onReset={() => {
            setPreviewUrl(null);
            setStage({ name: "idle" });
          }}
        />
      )}
    </div>
  );
}

// Plain-language heads-ups about files where compression has little to give.
function Notices({ kind, noun, size, analysis }: { kind: CompressKind; noun: string; size: number; analysis: Analysis | null }) {
  const notices: string[] = [];
  if (size <= TINY_FILE_BYTES) {
    notices.push(`This file is already very small (${formatBytes(size)}), so compressing it is unlikely to help.`);
  }
  if (kind !== "image" && analysis && (analysis.pictureCount === 0 || analysis.pictureBytes < size * 0.1)) {
    notices.push(`This ${noun} is mostly text, so it is already compact and will shrink very little. Its text and layout are never touched.`);
    if (kind === "pdf" && analysis.pictureCount === 0 && size > 200 * 1024) {
      notices.push("If it's a scan whose pages are stored in a different picture format, use “Try stronger compression” after compressing. That redraws the pages smaller but makes the text unselectable.");
    }
  }
  if (notices.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
      {notices.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function levelUsedLabel(report: CompressReport): string {
  const name = report.levelIndex === null ? null : COMPRESSION_LEVELS[report.levelIndex].name;
  if (name === null && report.mode === "level") return "None applied (no pictures to compress)";
  if (report.mode === "flatten") return name ? `${name}, pages redrawn as pictures` : "Pages redrawn as pictures";
  if (report.mode === "target") return name ? `${name} (picked automatically to fit your size)` : "Chosen automatically to fit your size";
  return name ?? "Custom";
}

function Result({
  stage,
  previewUrl,
  kind,
  onDownload,
  onStrong,
  onAgain,
  onReset,
}: {
  stage: Extract<Stage, { name: "done" }>;
  previewUrl: string | null;
  kind: CompressKind;
  onDownload: (report: CompressReport) => void;
  onStrong: () => void;
  onAgain: () => void;
  onReset: () => void;
}) {
  const { report } = stage;
  const targetLabel = report.targetBytes !== null ? formatBytes(report.targetBytes) : null;
  const saved = report.originalBytes - report.compressedBytes;
  const aggressive = report.levelIndex !== null && COMPRESSION_LEVELS[report.levelIndex].warning !== null;

  return (
    <div className="space-y-3">
      <div
        role="status"
        className={`space-y-2 rounded-lg border p-4 text-sm ${
          report.meaningful
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
            : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
        }`}
      >
        {report.meaningful ? (
          <>
            <p className="text-base font-semibold">Done: {report.reductionPct.toFixed(1)}% smaller</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-zinc-600 dark:text-zinc-400">Original</dt>
              <dd className="font-medium">{formatBytes(report.originalBytes)}</dd>
              <dt className="text-zinc-600 dark:text-zinc-400">Compressed</dt>
              <dd className="font-medium">{formatBytes(report.compressedBytes)}</dd>
              <dt className="text-zinc-600 dark:text-zinc-400">Reduced by</dt>
              <dd className="font-medium">
                {formatBytes(saved)} ({report.reductionPct.toFixed(1)}%)
              </dd>
              <dt className="text-zinc-600 dark:text-zinc-400">Level used</dt>
              <dd className="font-medium">{levelUsedLabel(report)}</dd>
            </dl>
            {aggressive && report.mode !== "target" && <p>Quality was reduced. Look the file over before you send it.</p>}
            {targetLabel && (
              <p className={report.targetMet ? "" : "font-medium text-amber-800 dark:text-amber-300"}>
                {report.targetMet
                  ? `Target of ${targetLabel} reached.`
                  : `Couldn't reach ${targetLabel} without unacceptable quality loss. This is the smallest good result.`}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-base font-semibold">{report.outcome === "larger" ? "Compression made this file larger" : "No worthwhile reduction"}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-zinc-600 dark:text-zinc-400">Original</dt>
              <dd className="font-medium">{formatBytes(report.originalBytes)}</dd>
              <dt className="text-zinc-600 dark:text-zinc-400">Compressed attempt</dt>
              <dd className="font-medium">{formatBytes(report.compressedBytes)}</dd>
              <dt className="text-zinc-600 dark:text-zinc-400">Level used</dt>
              <dd className="font-medium">{levelUsedLabel(report)}</dd>
            </dl>
            <p>
              {report.outcome === "larger"
                ? "The result was bigger than what you started with, so we kept your original. No size reduction is claimed."
                : "The saving was too small to be worth it, so we kept your original."}
              {targetLabel ? ` Your ${targetLabel} target couldn't be reached without damaging the file.` : ""}
            </p>
          </>
        )}
      </div>

      {report.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {kind === "image" && previewUrl && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Preview</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- client-generated blob URL */}
          <img src={previewUrl} alt="Compressed image preview" className="max-h-64 max-w-full rounded-lg border border-zinc-200 dark:border-zinc-800" />
        </div>
      )}

      {report.strongAvailable && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-3 text-sm dark:border-zinc-700">
          <p className="font-medium">Need it smaller?</p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            Stronger compression redraws each page as a picture at a lower resolution. It gets much smaller, but the text can no longer be selected or searched.
          </p>
          <button
            type="button"
            onClick={onStrong}
            className="mt-2 min-h-11 rounded-md border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
          >
            Try stronger compression
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onDownload(report)}
          className={
            report.meaningful
              ? "min-h-11 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
              : "min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700"
          }
        >
          {report.meaningful ? "Download compressed file" : "Download original file"}
        </button>
        {(kind === "pdf" || kind === "image") && (
          <PrintButton
            source="compress"
            title={printTitle(report.filename)}
            getPages={() =>
              kind === "pdf"
                ? pdfToPrintPages(report.data)
                : imageToPrintPages(new Blob([report.data as BlobPart], { type: report.mime }))
            }
          />
        )}
        <button type="button" onClick={onAgain} className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700">
          Try another level
        </button>
        <button type="button" onClick={onReset} className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700">
          Compress another file
        </button>
      </div>
      {report.meaningful && <p className="text-xs text-zinc-500">Your original file was not changed.</p>}
    </div>
  );
}

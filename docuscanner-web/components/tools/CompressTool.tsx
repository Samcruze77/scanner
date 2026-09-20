"use client";

// Compress PDF / Image / Word / Excel. Pick a file, pick a target size (or let it
// choose a good balance), and see the honest before/after. Everything runs in the
// browser; the compression code itself loads only when Compress is pressed.

import { useEffect, useState } from "react";
import { FileDropzone } from "@/components/convert/FileDropzone";
import { ErrorBanner } from "@/components/scanner/ErrorBanner";
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
import {
  CompressError,
  formatBytes,
  MIN_TARGET_BYTES,
  TARGET_PRESETS,
  type CompressKind,
  type CompressReport,
} from "@/utils/compress/types";

const KIND_COPY: Record<CompressKind, { title: string; hint: string; noun: string; help: string }> = {
  pdf: {
    title: "Choose a PDF",
    hint: "or drop it here. Text stays sharp and selectable; pictures inside are recompressed.",
    noun: "PDF",
    help: "Scanned and photo-heavy PDFs shrink the most. A PDF that is mostly text is already small.",
  },
  image: {
    title: "Choose an image",
    hint: "or drop it here. JPG, PNG and WebP are supported.",
    noun: "image",
    help: "Pick a quality and size, or give a target and we'll find the best quality that fits.",
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

const DIMENSIONS = [
  { value: "original", label: "Original size" },
  { value: "3000", label: "Up to 3000 px" },
  { value: "2000", label: "Up to 2000 px" },
  { value: "1600", label: "Up to 1600 px" },
  { value: "1200", label: "Up to 1200 px" },
  { value: "800", label: "Up to 800 px" },
] as const;

type Stage =
  | { name: "idle" }
  | { name: "ready"; file: File }
  | { name: "working"; file: File; label: string }
  | { name: "done"; file: File; report: CompressReport; strong: boolean };

export function CompressTool({ kind }: { kind: CompressKind }) {
  const copy = KIND_COPY[kind];
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [targetChoice, setTargetChoice] = useState<string>("balanced");
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState<"KB" | "MB">("MB");
  const [quality, setQuality] = useState(75);
  const [dimension, setDimension] = useState<string>("original");
  // Object URL of the compressed picture, so its quality can be checked by eye.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function resolveTarget(): { bytes: number | null } | { error: string } {
    if (targetChoice === "balanced") return { bytes: null };
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
    try {
      validateCompressFile(kind, file, new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    } catch (err) {
      const code = err instanceof CompressError ? err.code : "compress_failed";
      void trackCompressionFailed(kind, code);
      setError(compressErrorMessage(code));
      setStage({ name: "idle" });
      return;
    }
    setStage({ name: "ready", file });
  }

  async function run(file: File, strong: boolean) {
    const target = resolveTarget();
    if ("error" in target) {
      setError(target.error);
      return;
    }
    setError(null);
    setStage({ name: "working", file, label: "Reading the file…" });
    const startedAt = Date.now();
    void trackDocumentUploaded(file.type || "application/octet-stream", file.size);
    void trackCompressionStarted(kind);
    try {
      // The compression code (PDF writer, zip reader, codecs) loads only now.
      const { compressFile } = await import("@/utils/compress/browser");
      const report = await compressFile({
        kind,
        file,
        target: target.bytes,
        quality: quality / 100,
        maxDim: dimension === "original" ? null : Number(dimension),
        strong,
        onProgress: (label) => setStage({ name: "working", file, label }),
      });
      void trackCompressionCompleted(kind, Date.now() - startedAt, report.meaningful ? report.reductionPct : 0, report.targetMet);
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

  function download(report: CompressReport) {
    downloadBlob(new Blob([report.data as BlobPart], { type: report.mime }), report.filename);
    void trackDocumentDownloaded(kind === "image" ? report.mime.split("/")[1] : kind === "pdf" ? "pdf" : kind === "word" ? "docx" : "xlsx");
  }

  const fieldBase = "min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-black";
  const field = `${fieldBase} w-full`;

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

          <fieldset disabled={stage.name === "working"} className="space-y-4">
            <div>
              <label htmlFor="compress-target" className="mb-1 block text-sm font-medium">
                Target size
              </label>
              <select id="compress-target" value={targetChoice} onChange={(e) => setTargetChoice(e.target.value)} className={field}>
                <option value="balanced">{kind === "image" ? "No target: use the quality below" : "Best balance (recommended)"}</option>
                {TARGET_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>
                    Under {p.label}
                  </option>
                ))}
                <option value="custom">Custom size…</option>
              </select>
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
              <>
                {targetChoice === "balanced" && (
                  <div>
                    <label htmlFor="compress-quality" className="mb-1 flex justify-between text-sm font-medium">
                      <span>Quality</span>
                      <span className="text-zinc-500">{quality}%</span>
                    </label>
                    <input
                      id="compress-quality"
                      type="range"
                      min={40}
                      max={95}
                      step={5}
                      value={quality}
                      onChange={(e) => setQuality(Number(e.target.value))}
                      className="h-11 w-full"
                    />
                    <p className="text-xs text-zinc-500">Lower quality means a smaller file.</p>
                  </div>
                )}
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
              </>
            )}
          </fieldset>

          {stage.name === "ready" ? (
            <button
              type="button"
              onClick={() => void run(stage.file, false)}
              className="min-h-11 w-full rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white sm:w-auto dark:bg-white dark:text-black"
            >
              Compress {copy.noun}
            </button>
          ) : (
            <p role="status" className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500 dark:border-zinc-800">
              {stage.label}
            </p>
          )}
        </div>
      )}

      {stage.name === "done" && <Result stage={stage} previewUrl={previewUrl} kind={kind} onDownload={download} onStrong={() => void run(stage.file, true)} onReset={() => setStage({ name: "idle" })} />}
    </div>
  );
}

function Result({
  stage,
  previewUrl,
  kind,
  onDownload,
  onStrong,
  onReset,
}: {
  stage: Extract<Stage, { name: "done" }>;
  previewUrl: string | null;
  kind: CompressKind;
  onDownload: (report: CompressReport) => void;
  onStrong: () => void;
  onReset: () => void;
}) {
  const { report } = stage;
  const targetLabel = report.targetBytes !== null ? formatBytes(report.targetBytes) : null;

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
            <p className="text-base font-semibold">Done: {report.reductionPct}% smaller</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-zinc-600 dark:text-zinc-400">Original</dt>
              <dd className="font-medium">{formatBytes(report.originalBytes)}</dd>
              <dt className="text-zinc-600 dark:text-zinc-400">Compressed</dt>
              <dd className="font-medium">{formatBytes(report.compressedBytes)}</dd>
              <dt className="text-zinc-600 dark:text-zinc-400">Reduction</dt>
              <dd className="font-medium">{report.reductionPct}%</dd>
            </dl>
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
            <p className="text-base font-semibold">Already as small as it can safely be</p>
            <p>
              We couldn&apos;t shrink this file by a meaningful amount, so there&apos;s nothing to download.
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
        {report.meaningful && (
          <button
            type="button"
            onClick={() => onDownload(report)}
            className="min-h-11 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Download
          </button>
        )}
        <button type="button" onClick={onReset} className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700">
          Compress another file
        </button>
      </div>
    </div>
  );
}

"use client";

// PDF -> JPG / PNG. Choose a PDF, pick the format, resolution and pages, convert, then download
// one image or a ZIP of all of them. Runs in the browser (utils/convert/pdfToImage.ts); the
// PDF.js renderer and the ZIP writer load only when they are needed.

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ErrorBanner } from "@/components/scanner/ErrorBanner";
import {
  trackConversionCompleted,
  trackConversionStarted,
  trackDocumentDownloaded,
  trackDocumentUploaded,
  trackError,
} from "@/utils/analytics/events";
import { formatBytes } from "@/utils/compress/types";
import { downloadBlob } from "@/utils/convert/download";
import type { PdfImage, PdfInfo, PdfToImageProgress } from "@/utils/convert/pdfToImage";
import {
  DEFAULT_DPI,
  IMAGE_FORMATS,
  MAX_TOTAL_PIXELS,
  pageRenderSize,
  parsePageRange,
  RESOLUTIONS,
  type Dpi,
  type ImageFormat,
} from "@/utils/convert/pdfToImageCore";
import { fileBaseName } from "@/utils/files/filename";
import { getUserPlan, isFeatureAvailable } from "@/utils/features/plans";
import { isPdfFile, PdfError } from "@/utils/pdf/pdfjs";
import { pdfImportErrorMessage } from "@/utils/scanner/errorMessages";
import { FileDropzone } from "./FileDropzone";

const PREVIEW_LIMIT = 12;

const FORMAT_NOTES: Record<ImageFormat, string> = {
  jpg: "Smaller files for pages with photos or scans. Good for sharing and email.",
  png: "Lossless: the crispest text and lines. Larger files for photos and scans.",
};

function loadConverter() {
  return import("@/utils/convert/pdfToImage");
}

export function PdfToImageTool({ defaultFormat }: { defaultFormat: ImageFormat }) {
  const { user } = useAuth();
  const plan = getUserPlan(user);
  const available = isFeatureAvailable("convert.pdf_to_image", plan);

  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<PdfInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [format, setFormat] = useState<ImageFormat>(defaultFormat);
  const [dpi, setDpi] = useState<Dpi>(DEFAULT_DPI);
  const [allPages, setAllPages] = useState(true);
  const [rangeText, setRangeText] = useState("");
  const [progress, setProgress] = useState<PdfToImageProgress | null>(null);
  // The converted images, with preview URLs for the first few (made together, so they always match).
  const [result, setResult] = useState<{ images: PdfImage[]; previews: string[] } | null>(null);
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const readIdRef = useRef(0);
  const images = result?.images ?? null;
  const previews = result?.previews ?? [];

  // Release the preview URLs when the results are replaced or cleared, or the tool closes.
  useEffect(() => {
    if (!result) return;
    const urls = result.previews;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [result]);

  function setImages(next: PdfImage[] | null) {
    setResult(next ? { images: next, previews: next.slice(0, PREVIEW_LIMIT).map((image) => URL.createObjectURL(image.blob)) } : null);
  }

  if (!available) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">This tool isn&apos;t available on your plan.</p>;
  }

  const converting = progress !== null;
  const busy = converting || reading || zipping;
  const { ext, label: formatLabel } = IMAGE_FORMATS[format];
  const range = info ? (allPages ? parsePageRange("", info.pageCount) : parsePageRange(rangeText, info.pageCount)) : null;
  const rangeError = range && "error" in range && !allPages && rangeText.trim() !== "" ? range.error : null;
  const selected = range && "pages" in range ? range.pages : null;
  const firstSize = info && selected?.length ? pageRenderSize(info.pages[selected[0] - 1].widthPt, info.pages[selected[0] - 1].heightPt, dpi) : null;
  const tooMuch =
    info && selected
      ? selected.reduce((sum, n) => {
          const s = pageRenderSize(info.pages[n - 1].widthPt, info.pages[n - 1].heightPt, dpi);
          return sum + s.width * s.height;
        }, 0) > MAX_TOTAL_PIXELS
      : false;

  // Any change to the options makes earlier results out of date.
  function invalidate() {
    setImages(null);
    setError(null);
  }

  function reset() {
    readIdRef.current++;
    setFile(null);
    setInfo(null);
    setReading(false);
    setImages(null);
    setError(null);
    setAllPages(true);
    setRangeText("");
  }

  async function handleFile(chosen: File) {
    reset();
    if (!isPdfFile(chosen)) {
      setError("That file isn't a PDF. Please choose a PDF file.");
      void trackError("pdf_to_image", "unsupported_file_type");
      return;
    }
    void trackDocumentUploaded(chosen.type || "application/pdf", chosen.size);
    setFile(chosen);
    setReading(true);
    const id = ++readIdRef.current;
    try {
      const { readPdfInfo } = await loadConverter();
      const read = await readPdfInfo(chosen);
      if (id !== readIdRef.current) return;
      setInfo(read);
    } catch (err) {
      if (id !== readIdRef.current) return;
      const code = err instanceof PdfError ? err.code : "pdf_failed";
      setError(pdfImportErrorMessage(code));
      void trackError("pdf_to_image", code);
      setFile(null);
    } finally {
      if (id === readIdRef.current) setReading(false);
    }
  }

  async function handleConvert() {
    if (!file || !info || !selected || busy || tooMuch) return;
    setError(null);
    setImages(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: selected.length });
    const conversion = `pdf_to_${format}`;
    const startedAt = Date.now();
    void trackConversionStarted(conversion);
    try {
      const { convertPdfToImages } = await loadConverter();
      const result = await convertPdfToImages(file, {
        format,
        dpi,
        pages: selected,
        baseName: fileBaseName(file.name, "page"),
        signal: controller.signal,
        onProgress: setProgress,
      });
      void trackConversionCompleted(conversion, Date.now() - startedAt);
      setImages(result);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof PdfError) {
        setError(pdfImportErrorMessage(err.code));
        void trackError("pdf_to_image", err.code);
      } else if (err instanceof Error && err.name === "PdfToImageError" && err.message === "too_much_output") {
        setError("That is too many pages at this resolution to make in a browser. Choose a lower resolution or fewer pages.");
        void trackError("pdf_to_image", "too_much_output");
      } else {
        setError("Couldn't convert that PDF. Try a lower resolution, or try again.");
        void trackError("pdf_to_image", err instanceof Error ? err.message : "conversion_failed");
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  }

  async function handleDownloadAll() {
    if (!images || !file || zipping) return;
    if (images.length === 1) {
      downloadBlob(images[0].blob, images[0].fileName);
      void trackDocumentDownloaded(ext);
      return;
    }
    setZipping(true);
    try {
      const { zipImages } = await loadConverter();
      downloadBlob(await zipImages(images), `${fileBaseName(file.name, "pages")}-${ext}.zip`);
      void trackDocumentDownloaded("zip");
    } catch {
      setError("Couldn't make the ZIP file. Download the images one at a time instead.");
      void trackError("pdf_to_image", "zip_failed");
    } finally {
      setZipping(false);
    }
  }

  function downloadOne(image: PdfImage) {
    downloadBlob(image.blob, image.fileName);
    void trackDocumentDownloaded(ext);
  }

  const totalBytes = images?.reduce((sum, image) => sum + image.blob.size, 0) ?? 0;
  const lowerDpi = images?.some((image) => image.dpi < dpi);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {!file ? (
        <FileDropzone
          accept="application/pdf,.pdf"
          title="Choose a PDF"
          hint={`or drop it here. Every page becomes a ${formatLabel} image. Your file stays on your device.`}
          onFile={(chosen) => void handleFile(chosen)}
        />
      ) : (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {reading ? "Reading the PDF…" : info ? `${info.pageCount} page${info.pageCount === 1 ? "" : "s"}` : ""}
              </p>
            </div>
            <button type="button" disabled={converting || zipping} onClick={reset} className="btn btn-ghost">
              Choose a different file
            </button>
          </div>

          {info && (
            <div className="space-y-4">
              <fieldset disabled={busy} className="space-y-2">
                <legend className="panel-title mb-1">Image format</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(IMAGE_FORMATS) as ImageFormat[]).map((f) => (
                    <label
                      key={f}
                      className="card flex min-h-11 cursor-pointer items-start gap-3 p-3 has-[:checked]:border-blue-600 has-[:checked]:bg-selected"
                    >
                      <input
                        type="radio"
                        name="pdf-image-format"
                        value={f}
                        checked={format === f}
                        onChange={() => {
                          setFormat(f);
                          invalidate();
                        }}
                        className="mt-1"
                      />
                      <span className="text-sm">
                        <span className="font-semibold">{IMAGE_FORMATS[f].label}</span>
                        <span className="block text-zinc-600 dark:text-zinc-400">{FORMAT_NOTES[f]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset disabled={busy} className="space-y-2">
                <legend className="panel-title mb-1">Resolution</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {RESOLUTIONS.map((r) => (
                    <label
                      key={r.dpi}
                      className="card flex min-h-11 cursor-pointer items-start gap-3 p-3 has-[:checked]:border-blue-600 has-[:checked]:bg-selected"
                    >
                      <input
                        type="radio"
                        name="pdf-image-dpi"
                        value={r.dpi}
                        checked={dpi === r.dpi}
                        onChange={() => {
                          setDpi(r.dpi);
                          invalidate();
                        }}
                        className="mt-1"
                      />
                      <span className="text-sm">
                        <span className="font-semibold">{r.label}</span>
                        <span className="block text-zinc-600 dark:text-zinc-400">{r.note}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {info.pageCount > 1 && (
                <fieldset disabled={busy} className="space-y-2">
                  <legend className="panel-title mb-1">Pages</legend>
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="radio"
                      name="pdf-image-pages"
                      checked={allPages}
                      onChange={() => {
                        setAllPages(true);
                        invalidate();
                      }}
                    />
                    All {info.pageCount} pages
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="radio"
                        name="pdf-image-pages"
                        checked={!allPages}
                        onChange={() => {
                          setAllPages(false);
                          invalidate();
                        }}
                      />
                      Only these pages:
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      aria-label="Pages to convert"
                      aria-invalid={rangeError ? true : undefined}
                      aria-describedby="pdf-image-range-help"
                      placeholder={`e.g. 1-3, ${Math.min(5, info.pageCount)}`}
                      value={rangeText}
                      onFocus={() => setAllPages(false)}
                      onChange={(e) => {
                        setAllPages(false);
                        setRangeText(e.target.value);
                        invalidate();
                      }}
                      className="field max-w-48"
                    />
                  </div>
                  <p id="pdf-image-range-help" className={`text-xs ${rangeError ? "text-red-700 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {rangeError ?? `Page numbers and ranges, separated by commas. This PDF has pages 1 to ${info.pageCount}.`}
                  </p>
                </fieldset>
              )}

              {firstSize && selected && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {selected.length} {formatLabel} image{selected.length === 1 ? "" : "s"}, about {firstSize.width.toLocaleString("en-US")} ×{" "}
                  {firstSize.height.toLocaleString("en-US")} pixels{selected.length > 1 ? " for the first" : ""}.
                  {firstSize.capped ? ` This page is very large, so it is made at ${firstSize.effectiveDpi} DPI to stay within what a browser can draw.` : ""}
                </p>
              )}
              {tooMuch && (
                <p role="alert" className="notice notice-warning">
                  That is too many pages at {dpi} DPI to make in a browser. Choose a lower resolution or fewer pages.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                {images ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleDownloadAll()}
                      disabled={zipping}
                      data-assistant-id="convert-download"
                      className="btn btn-primary"
                    >
                      {images.length === 1 ? `Download ${formatLabel}` : zipping ? "Making the ZIP…" : `Download all (${images.length} images, ZIP)`}
                    </button>
                    <button type="button" onClick={() => void handleConvert()} disabled={zipping} className="btn btn-secondary">
                      Convert again
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleConvert()}
                    disabled={busy || !selected || tooMuch}
                    data-assistant-id="convert-start"
                    className="btn btn-primary"
                  >
                    {converting ? "Converting…" : `Convert to ${formatLabel}`}
                  </button>
                )}
                {converting && (
                  <>
                    <button type="button" onClick={() => abortRef.current?.abort()} className="btn btn-ghost">
                      Cancel
                    </button>
                    <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
                      {progress && progress.done < progress.total
                        ? `Making image ${progress.done + 1} of ${progress.total}…`
                        : "Finishing…"}
                    </p>
                  </>
                )}
              </div>

              {images && (
                <div className="space-y-3">
                  <p role="status" className="notice notice-success">
                    Done: {images.length} {formatLabel} image{images.length === 1 ? "" : "s"}, {formatBytes(totalBytes)} in total.
                    {lowerDpi ? " Very large pages were made at a lower resolution so a browser could draw them." : ""}
                  </p>
                  <ul aria-label="Converted pages" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {images.slice(0, PREVIEW_LIMIT).map((image, i) => (
                      <li key={image.pageNumber} className="card flex flex-col gap-2 p-2">
                        <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-white">
                          {previews[i] && (
                            // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, not an optimisable asset
                            <img
                              src={previews[i]}
                              alt={`Page ${image.pageNumber} as a ${formatLabel} image`}
                              width={image.width}
                              height={image.height}
                              className="max-h-full max-w-full object-contain shadow-sm"
                            />
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span>
                            Page {image.pageNumber}
                            <span className="block text-zinc-500 dark:text-zinc-400">
                              {image.width} × {image.height}, {formatBytes(image.blob.size)}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => downloadOne(image)}
                            className="btn btn-ghost min-h-11 px-2"
                            aria-label={`Download page ${image.pageNumber} as ${formatLabel}`}
                          >
                            Download
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {images.length > PREVIEW_LIMIT && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      Showing the first {PREVIEW_LIMIT}. All {images.length} images are in the ZIP.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

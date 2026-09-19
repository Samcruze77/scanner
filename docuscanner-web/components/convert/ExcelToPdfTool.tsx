"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ErrorBanner } from "@/components/scanner/ErrorBanner";
import {
  trackConversionCompleted,
  trackConversionStarted,
  trackDocumentDownloaded,
  trackDocumentUploaded,
  trackError,
} from "@/utils/analytics/events";
import { downloadBlob, outputFilename } from "@/utils/convert/download";
import { excelErrorMessage } from "@/utils/convert/errorMessages";
import {
  ExcelConvertError,
  loadWorkbook,
  workbookToPdf,
  type ExcelToPdfResult,
  type LoadedWorkbook,
  type Orientation,
} from "@/utils/convert/excelToPdf";
import { getUserPlan, isFeatureAvailable } from "@/utils/features/plans";
import { FileDropzone } from "./FileDropzone";

const ACCEPT =
  ".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

type Stage =
  | { name: "idle" }
  | { name: "loading" }
  | { name: "ready"; fileName: string; loaded: LoadedWorkbook }
  | { name: "converting"; fileName: string; loaded: LoadedWorkbook; progress: number }
  | { name: "done"; fileName: string; loaded: LoadedWorkbook; result: ExcelToPdfResult };

export function ExcelToPdfTool() {
  const { user } = useAuth();
  const available = isFeatureAvailable("convert.excel_to_pdf", getUserPlan(user));

  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [orientation, setOrientation] = useState<Orientation>("auto");
  const [gridlines, setGridlines] = useState(true);

  if (!available) {
    return <p className="text-sm text-zinc-500">This tool isn&apos;t available on your plan.</p>;
  }

  async function handleFile(file: File) {
    setError(null);
    setStage({ name: "loading" });
    try {
      void trackDocumentUploaded(file.type || "application/octet-stream", file.size);
      const loaded = await loadWorkbook(file);
      // Start with every sheet that has something in it selected.
      setSelected(new Set(loaded.sheets.filter((s) => s.rows > 0).map((s) => s.name)));
      setStage({ name: "ready", fileName: file.name, loaded });
    } catch (err) {
      const code = err instanceof ExcelConvertError ? err.code : "excel_unreadable";
      setError(excelErrorMessage(code));
      void trackError("excel_to_pdf", code);
      setStage({ name: "idle" });
    }
  }

  async function handleConvert() {
    if (stage.name !== "ready" && stage.name !== "done") return;
    const { fileName, loaded } = stage;
    const sheetNames = loaded.sheets.map((s) => s.name).filter((name) => selected.has(name));
    if (sheetNames.length === 0) return;

    setError(null);
    setStage({ name: "converting", fileName, loaded, progress: 0 });
    const startedAt = Date.now();
    void trackConversionStarted("excel_to_pdf");
    try {
      const result = await workbookToPdf(loaded, {
        sheetNames,
        orientation,
        showGridlines: gridlines,
        onProgress: (progress) => setStage({ name: "converting", fileName, loaded, progress }),
      });
      void trackConversionCompleted("excel_to_pdf", Date.now() - startedAt);
      setStage({ name: "done", fileName, loaded, result });
    } catch (err) {
      const code = err instanceof ExcelConvertError ? err.code : "conversion_failed";
      setError(excelErrorMessage(code));
      void trackError("excel_to_pdf", code);
      setStage({ name: "ready", fileName, loaded });
    }
  }

  function handleDownload() {
    if (stage.name !== "done") return;
    downloadBlob(stage.result.blob, outputFilename(stage.fileName, "pdf"));
    void trackDocumentDownloaded("pdf");
  }

  // Changing any option makes a finished PDF out of date.
  function invalidateResult() {
    setStage((current) =>
      current.name === "done" ? { name: "ready", fileName: current.fileName, loaded: current.loaded } : current,
    );
  }

  function toggleSheet(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    invalidateResult();
  }

  const working = stage.name === "loading" || stage.name === "converting";
  const loaded = stage.name === "ready" || stage.name === "converting" || stage.name === "done" ? stage.loaded : null;
  const fileName = loaded && "fileName" in stage ? stage.fileName : null;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {!loaded ? (
        <FileDropzone
          accept={ACCEPT}
          title={stage.name === "loading" ? "Reading spreadsheet…" : "Choose an Excel or CSV file"}
          hint="or drop it here. .xlsx and .csv are supported. Your file stays on your device."
          disabled={working}
          onFile={handleFile}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="min-w-0 truncate text-sm font-medium">{fileName}</p>
            <button
              type="button"
              disabled={working}
              onClick={() => {
                setStage({ name: "idle" });
                setError(null);
              }}
              className="min-h-11 rounded-md px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Choose a different file
            </button>
          </div>

          <fieldset disabled={working} className="space-y-2">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Sheets to include</legend>
            {loaded.sheets.map((sheet) => (
              <label
                key={sheet.name}
                className="flex min-h-11 items-center gap-3 rounded-md border border-zinc-200 px-3 text-sm dark:border-zinc-800"
              >
                <input
                  type="checkbox"
                  checked={selected.has(sheet.name)}
                  disabled={sheet.rows === 0}
                  onChange={() => toggleSheet(sheet.name)}
                  className="h-4 w-4 accent-blue-600"
                />
                <span className="min-w-0 flex-1 truncate font-medium">{sheet.name}</span>
                <span className="shrink-0 text-zinc-500">
                  {sheet.rows === 0 ? "empty" : `${sheet.rows} rows × ${sheet.columns} columns`}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="font-medium">Page orientation</span>
              <select
                value={orientation}
                disabled={working}
                onChange={(e) => {
                  setOrientation(e.target.value as Orientation);
                  invalidateResult();
                }}
                className="min-h-11 rounded-md border border-zinc-300 bg-transparent px-2 dark:border-zinc-700"
              >
                {ORIENTATIONS.map((o) => (
                  <option key={o.value} value={o.value} className="text-black">
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={gridlines}
                disabled={working}
                onChange={(e) => {
                  setGridlines(e.target.checked);
                  invalidateResult();
                }}
                className="h-4 w-4 accent-blue-600"
              />
              <span className="font-medium">Show gridlines</span>
            </label>
          </div>

          <p className="text-sm text-zinc-500">
            Values, fonts, colours, borders and merged cells are kept. Charts, pictures and non-Latin text
            (for example Chinese or Arabic) can&apos;t be included.
          </p>
          {loaded.sheetsWithImages.length > 0 && (
            <p role="note" className="text-sm text-amber-700 dark:text-amber-400">
              Pictures in {loaded.sheetsWithImages.map((n) => `"${n}"`).join(", ")} won&apos;t appear in the PDF.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {stage.name !== "done" ? (
              <button
                type="button"
                onClick={handleConvert}
                disabled={working || selected.size === 0}
                className="min-h-11 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
              >
                {stage.name === "converting" ? "Converting…" : "Convert to PDF"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="min-h-11 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={handleConvert}
                  className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700"
                >
                  Convert again
                </button>
              </>
            )}
            {stage.name === "converting" && (
              <p role="status" className="text-sm text-zinc-500">
                {Math.round(stage.progress * 100)}%
              </p>
            )}
          </div>

          {stage.name === "done" && (
            <div role="status" className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
              <p className="font-medium text-emerald-800 dark:text-emerald-300">
                Done: {stage.result.pageCount} page{stage.result.pageCount === 1 ? "" : "s"}.
              </p>
              {stage.result.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-emerald-900 dark:text-emerald-200">
                  {stage.result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

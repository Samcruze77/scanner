"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { PrintButton } from "@/components/print/PrintButton";
import { ARM_MAX_PAGES, useArmedDocument } from "@/components/print/useArmedDocument";
import { ErrorBanner } from "@/components/scanner/ErrorBanner";
import {
  trackConversionCompleted,
  trackConversionStarted,
  trackDocumentDownloaded,
  trackDocumentUploaded,
  trackError,
} from "@/utils/analytics/events";
import { downloadBlob, outputFilename } from "@/utils/convert/download";
import { wordErrorMessage } from "@/utils/convert/errorMessages";
import { WordConvertError } from "@/utils/convert/wordErrors";
import { getUserPlan, isFeatureAvailable } from "@/utils/features/plans";
import { summarizePdf } from "@/utils/pdf/preview";
import { pdfToPrintPages, printTitle } from "@/utils/print/sources";
import { setPendingImport } from "@/utils/scanner/handoff";
import { FileDropzone } from "./FileDropzone";

const ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const STAGE_LABELS = {
  reading: "Reading the document…",
  converting: "Converting the content…",
  building: "Building the PDF…",
} as const;

type Stage =
  | { name: "idle" }
  | { name: "working"; fileName: string; label: string }
  | {
      name: "done";
      fileName: string;
      blob: Blob;
      pageCount: number;
      preview: string | null;
      warnings: string[];
    };

export function WordToPdfTool() {
  const { user } = useAuth();
  const router = useRouter();
  const available = isFeatureAvailable("convert.word_to_pdf", getUserPlan(user));

  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);

  // The converted PDF is the document on screen: the browser's print command prints just it.
  const converted = stage.name === "done" ? stage : null;
  useArmedDocument({
    hasDocument: converted !== null,
    active: true,
    docKey: converted?.blob ?? null,
    title: converted ? printTitle(converted.fileName) : undefined,
    load: () => (converted ? pdfToPrintPages(converted.blob, { maxPages: ARM_MAX_PAGES }) : Promise.resolve([])),
  });

  if (!available) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">This tool isn&apos;t available on your plan.</p>;
  }

  async function handleFile(file: File) {
    setError(null);
    setStage({ name: "working", fileName: file.name, label: STAGE_LABELS.reading });
    const startedAt = Date.now();
    void trackDocumentUploaded(file.type || "application/octet-stream", file.size);
    void trackConversionStarted("word_to_pdf");
    try {
      // The converter (layout engine, PDF writer and fonts) is large, so it only
      // loads once a document has actually been chosen.
      const { convertDocxToPdf } = await import("@/utils/convert/wordToPdf");
      const result = await convertDocxToPdf(file, {
        onStage: (s) => setStage({ name: "working", fileName: file.name, label: STAGE_LABELS[s] }),
      });
      const summary = await summarizePdf(result.blob).catch(() => ({ pageCount: 0, previewDataUrl: null }));
      void trackConversionCompleted("word_to_pdf", Date.now() - startedAt);
      setStage({
        name: "done",
        fileName: file.name,
        blob: result.blob,
        pageCount: summary.pageCount || result.pageCount,
        preview: summary.previewDataUrl,
        warnings: result.warnings,
      });
    } catch (err) {
      const code = err instanceof WordConvertError ? err.code : "word_failed";
      setError(wordErrorMessage(code));
      void trackError("word_to_pdf", code);
      setStage({ name: "idle" });
    }
  }

  function handleDownload() {
    if (stage.name !== "done") return;
    downloadBlob(stage.blob, outputFilename(stage.fileName, "pdf"));
    void trackDocumentDownloaded("pdf");
  }

  // Opens the converted PDF in the scanner so it can be edited and signed. The
  // file is passed through memory only.
  function handleEditAndSign() {
    if (stage.name !== "done") return;
    setPendingImport([new File([stage.blob], outputFilename(stage.fileName, "pdf"), { type: "application/pdf" })]);
    router.push("/scan");
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {stage.name === "idle" && (
        <FileDropzone
          accept={ACCEPT}
          title="Choose a Word document"
          hint="or drop it here. .docx files are supported. Your file stays on your device."
          onFile={handleFile}
        />
      )}

      {stage.name === "working" && (
        <div role="status" className="card p-4 text-sm">
          <p className="truncate font-medium">{stage.fileName}</p>
          <p className="mt-1 text-zinc-500 dark:text-zinc-400">{stage.label}</p>
        </div>
      )}

      {stage.name === "done" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 card p-3">
            <p className="min-w-0 truncate text-sm font-medium">{stage.fileName}</p>
            <button
              type="button"
              onClick={() => {
                setStage({ name: "idle" });
                setError(null);
              }}
              className="btn btn-ghost"
            >
              Choose a different file
            </button>
          </div>

          <div
            role="status"
            className="notice notice-success !block space-y-2"
          >
            <p className="font-medium">
              Done{stage.pageCount > 0 ? `: ${stage.pageCount} page${stage.pageCount === 1 ? "" : "s"}` : ""}.
            </p>
            {stage.warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {stage.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <p>
              Fonts, sizes, spacing, margins, lists, tables, pictures, headers and footers are taken from your document.
              Look-alike fonts with identical character widths stand in for Calibri, Arial, Times New Roman, Courier New
              and Cambria, so lines and pages break where they do in Word.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className="btn btn-primary"
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={handleEditAndSign}
              className="btn btn-secondary"
            >
              Edit &amp; sign this PDF
            </button>
            <PrintButton source="convert" title={printTitle(stage.fileName)} getPages={() => pdfToPrintPages(stage.blob)} />
          </div>

          {stage.preview && (
            <div>
              <p className="panel-title mb-1">Preview (first page)</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
              <img
                src={stage.preview}
                alt="First page of the converted PDF"
                className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white dark:border-zinc-800"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AdSlot } from "@/components/ads/AdSlot";
import { fileToCapturedImage, type CapturedImage } from "@/utils/scanner/image";
import { createInitialPage, type PageRotation, type ScannerPage } from "@/utils/scanner/page";
import { detectPageQuad, renderPage } from "@/utils/scanner/pageProcessing";
import { createPdfFromPages } from "@/utils/scanner/pdf";
import { validateImageFile } from "@/utils/scanner/validation";
import { cameraErrorMessage, uploadErrorMessage } from "@/utils/scanner/errorMessages";
import { saveDocumentToAccount } from "@/utils/documents/save";
import { getUserPlan, isFeatureAvailable } from "@/utils/features/plans";
import type { EnhancementMode } from "@/utils/scanner/enhance";
import {
  trackDocumentCreated,
  trackDocumentDownloaded,
  trackDocumentUploaded,
  trackError,
  trackFeatureUsed,
  trackScanCompleted,
  trackScanStarted,
} from "@/utils/analytics/events";
import { CameraCapture } from "./CameraCapture";
import { PageList } from "./PageList";
import { PageEditor } from "./PageEditor";
import { ErrorBanner } from "./ErrorBanner";
import { OcrPanel } from "./OcrPanel";
import { useOcr } from "./useOcr";

type Mode = "idle" | "camera";

// A page whose detected boundary covers at least this much confidence gets
// auto-cropped by default; below it we keep the original framing rather
// than force a bad crop, per requirement C.
const AUTO_CROP_CONFIDENCE_THRESHOLD = 0.55;

export function ScannerWorkspace({ initialMode }: { initialMode?: "camera" | "upload" }) {
  const { user, openAuthModal } = useAuth();
  // Derive the starting mode directly from the prop instead of setting it
  // from an effect -- avoids an extra render and a setState-in-effect.
  const [mode, setMode] = useState<Mode>(initialMode === "camera" ? "camera" : "idle");
  const [pages, setPages] = useState<ScannerPage[]>([]);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [creatingPdf, setCreatingPdf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const plan = getUserPlan(user);
  const ocrEnabled = isFeatureAvailable("ocr.basic", plan);
  const ocr = useOcr(plan);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanStartedRef = useRef(false);
  const scanCompletedRef = useRef(false);

  const markScanStarted = useCallback((source: "camera" | "upload") => {
    if (scanStartedRef.current) return;
    scanStartedRef.current = true;
    void trackScanStarted(source);
  }, []);

  // Fires once per scan session, the moment the user declares the
  // capture/upload stage done and moves to processing -- independent of
  // whether PDF generation (a separate, later step) actually succeeds. A
  // retry of PDF generation after a failure must NOT re-fire this.
  const markScanCompleted = useCallback((pageCount: number) => {
    if (scanCompletedRef.current) return;
    scanCompletedRef.current = true;
    void trackScanCompleted(pageCount);
  }, []);

  // The only place that touches `pages` state for processing updates --
  // always a pure functional map, so it's a safe no-op if the page in
  // question was removed while it was mid-processing (handles the
  // "processing cancellation" case without extra bookkeeping).
  const updatePageFields = useCallback((id: string, patch: Partial<ScannerPage>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  // Runs detection then the render pipeline for a freshly-added page.
  const runDetectionAndRender = useCallback(
    async (page: ScannerPage) => {
      let quad: ScannerPage["quad"] = null;
      let confidence = 0;
      try {
        const detection = await detectPageQuad(page, (label) => updatePageFields(page.id, { statusLabel: label }));
        quad = detection?.quad ?? null;
        confidence = detection?.confidence ?? 0;
      } catch {
        // Detection failure is treated the same as "no confident detection"
        // -- fall back to the original image, not an error state.
        quad = null;
        confidence = 0;
      }

      const cropEnabled = confidence >= AUTO_CROP_CONFIDENCE_THRESHOLD;
      const withDetection: ScannerPage = { ...page, quad, quadConfidence: confidence, cropEnabled };
      updatePageFields(page.id, {
        quad,
        quadConfidence: confidence,
        cropEnabled,
        status: "processing",
        statusLabel: "Preparing page…",
      });

      try {
        const result = await renderPage(withDetection, (label) => updatePageFields(page.id, { statusLabel: label }));
        updatePageFields(page.id, {
          processedDataUrl: result.dataUrl,
          processedWidth: result.width,
          processedHeight: result.height,
          status: "ready",
          statusLabel: null,
        });
        if (result.perspectiveFailed) {
          updatePageFields(page.id, { cropEnabled: false });
          void trackError("perspective_correction", "correction_failed");
        }
      } catch {
        updatePageFields(page.id, {
          status: "error",
          statusLabel: null,
          processedDataUrl: page.originalDataUrl,
          processedWidth: page.originalWidth,
          processedHeight: page.originalHeight,
        });
        setError("Couldn't process one of the pages -- showing the original instead.");
        void trackError("page_processing", "processing_failed");
      }
    },
    [updatePageFields],
  );

  // Re-renders a page after an editor change (crop toggle, rotate,
  // enhancement, reset). Takes the current page object directly (from the
  // render that triggered it) rather than re-reading state inside an async
  // function, so there's nothing impure happening inside a setState updater.
  const reprocessPage = useCallback(
    async (page: ScannerPage, patch: Partial<ScannerPage>) => {
      const target: ScannerPage = { ...page, ...patch };
      updatePageFields(page.id, { ...patch, status: "processing", statusLabel: "Processing…" });
      try {
        const result = await renderPage(target, (label) => updatePageFields(page.id, { statusLabel: label }));
        updatePageFields(page.id, {
          processedDataUrl: result.dataUrl,
          processedWidth: result.width,
          processedHeight: result.height,
          status: "ready",
          statusLabel: null,
        });
        if (result.perspectiveFailed) {
          updatePageFields(page.id, { cropEnabled: false });
          setError("Couldn't correct perspective for this page -- keeping it uncropped.");
          void trackError("perspective_correction", "correction_failed");
        }
      } catch {
        updatePageFields(page.id, { status: "error", statusLabel: null });
        setError("Couldn't process this page. Please try again.");
        void trackError("page_processing", "processing_failed");
      }
    },
    [updatePageFields],
  );

  const handleOpenCamera = useCallback(() => {
    setError(null);
    markScanStarted("camera");
    setMode("camera");
  }, [markScanStarted]);

  const handleUploadClick = useCallback(() => {
    setError(null);
    fileInputRef.current?.click();
  }, []);

  useEffect(() => {
    // Runs once on mount only, to act on the initial ?mode= deep link.
    // Neither branch calls a React state setter: the "camera" case is
    // already reflected in useState's initializer above (marking the scan
    // started is a ref + fire-and-forget network call, not setState), and
    // the "upload" case just clicks the hidden file input.
    if (initialMode === "camera") markScanStarted("camera");
    if (initialMode === "upload") fileInputRef.current?.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCameraError(reason: string) {
    setMode("idle");
    setError(cameraErrorMessage(reason));
    void trackError("camera", reason);
  }

  function handleCameraCapture(captured: CapturedImage) {
    const initial = createInitialPage(captured);
    setPages((prev) => [...prev, initial]);
    void runDetectionAndRender(initial);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file later
    if (files.length === 0) return;

    for (const file of files) {
      const validationError = validateImageFile(file);
      if (validationError) {
        setError(uploadErrorMessage(validationError));
        void trackError("upload", validationError);
        continue;
      }
      try {
        const captured = await fileToCapturedImage(file);
        const initial = createInitialPage(captured);
        setPages((prev) => [...prev, initial]);
        markScanStarted("upload");
        void trackDocumentUploaded(file.type, file.size);
        void runDetectionAndRender(initial);
      } catch {
        setError(uploadErrorMessage("image_decode_failed"));
        void trackError("upload", "image_decode_failed");
      }
    }
  }

  function handleRemovePage(id: string) {
    setPages((prev) => prev.filter((p) => p.id !== id));
    setEditingPageId((current) => (current === id ? null : current));
    void trackFeatureUsed("remove_page");
  }

  function handleMovePage(id: string, direction: "up" | "down") {
    setPages((prev) => {
      const index = prev.findIndex((p) => p.id === id);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
    void trackFeatureUsed("reorder_page");
  }

  const editingPage = pages.find((p) => p.id === editingPageId) ?? null;
  const editingIndex = editingPage ? pages.findIndex((p) => p.id === editingPage.id) : -1;

  function handleEditorRotate(direction: "left" | "right") {
    if (!editingPage) return;
    const delta = direction === "right" ? 90 : -90;
    const rotation = ((((editingPage.rotation + delta) % 360) + 360) % 360) as PageRotation;
    void trackFeatureUsed("rotate_page");
    void reprocessPage(editingPage, { rotation });
  }

  function handleEditorToggleCrop() {
    if (!editingPage) return;
    const cropEnabled = !editingPage.cropEnabled;
    if (cropEnabled) {
      void trackFeatureUsed("auto_crop");
      void trackFeatureUsed("perspective_correction");
    }
    void reprocessPage(editingPage, { cropEnabled });
  }

  function handleEditorEnhancementChange(enhancement: EnhancementMode) {
    if (!editingPage || editingPage.enhancement === enhancement) return;
    if (enhancement !== "original") void trackFeatureUsed("enhancement");
    void reprocessPage(editingPage, { enhancement });
  }

  function handleEditorReset() {
    if (!editingPage) return;
    void reprocessPage(editingPage, { cropEnabled: false, rotation: 0, enhancement: "original" });
  }

  const anyPageProcessing = pages.some((p) => p.status === "detecting" || p.status === "processing");

  async function handleCreatePdf() {
    if (pages.length === 0 || creatingPdf || anyPageProcessing) return;

    // The capture/upload stage is done the moment the user asks to move to
    // processing -- this is a separate event from, and not gated on,
    // whether PDF generation below succeeds.
    markScanCompleted(pages.length);

    setError(null);
    setCreatingPdf(true);
    try {
      const blob = await createPdfFromPages(pages);
      setPdfBlob(blob);
      void trackDocumentCreated(pages.length);
    } catch {
      setError("Couldn't create the PDF. Please try again.");
      void trackError("pdf_generation", "pdf_generation_failed");
    } finally {
      setCreatingPdf(false);
    }
  }

  function handleDownload() {
    if (!pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "document.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    void trackDocumentDownloaded("pdf");
  }

  async function handleSaveToAccount() {
    if (!pdfBlob) return;
    if (!user) {
      openAuthModal("login");
      return;
    }
    setSaving(true);
    setSaveNotice(null);
    try {
      await saveDocumentToAccount({
        userId: user.id,
        title: `Scan ${new Date().toLocaleDateString()}`,
        blob: pdfBlob,
        pageCount: pages.length,
      });
      setSaveNotice("Saved to your account. Find it under History.");
      void trackFeatureUsed("save_to_account");
    } catch {
      setError("Couldn't save this document. Please try again.");
      void trackError("save", "save_failed");
    } finally {
      setSaving(false);
    }
  }

  function handleExtractAllText() {
    void ocr.start(pages, { kind: "document" });
  }

  function handleExtractPageText() {
    if (!editingPage) return;
    const pageId = editingPage.id;
    setEditingPageId(null);
    void ocr.start(pages, { kind: "page", pageId });
  }

  function handleStartOver() {
    ocr.reset();
    setPages([]);
    setEditingPageId(null);
    setPdfBlob(null);
    setSaveNotice(null);
    setError(null);
    scanStartedRef.current = false;
    scanCompletedRef.current = false;
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="sr-only"
        aria-label="Upload document photo"
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {mode === "camera" ? (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setMode("idle")}
          onError={handleCameraError}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleOpenCamera}
            className="min-h-11 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Use camera
          </button>
          <button
            type="button"
            onClick={handleUploadClick}
            className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700"
          >
            Upload photo
          </button>
        </div>
      )}

      <PageList
        pages={pages}
        onEdit={setEditingPageId}
        onRemove={handleRemovePage}
        onMove={handleMovePage}
      />

      <AdSlot variant="workspace" />

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="button"
          onClick={handleCreatePdf}
          disabled={pages.length === 0 || creatingPdf || anyPageProcessing}
          className="min-h-11 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {creatingPdf
            ? "Preparing PDF…"
            : `Create PDF (${pages.length} page${pages.length === 1 ? "" : "s"})`}
        </button>

        {ocrEnabled && (
          <button
            type="button"
            onClick={handleExtractAllText}
            disabled={pages.length === 0 || anyPageProcessing || ocr.running}
            className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            {pages.length > 1 ? `Extract text (${pages.length} pages)` : "Extract text"}
          </button>
        )}
        {ocrEnabled && ocr.hasResult && !ocr.panelOpen && (
          <button
            type="button"
            onClick={ocr.openPanel}
            className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700"
          >
            View extracted text
          </button>
        )}

        {pdfBlob && (
          <>
            <button
              type="button"
              onClick={handleDownload}
              className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium dark:border-zinc-700"
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={handleSaveToAccount}
              disabled={saving}
              className="min-h-11 rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
            >
              {saving ? "Saving…" : "Save to account"}
            </button>
            <button
              type="button"
              onClick={handleStartOver}
              className="min-h-11 rounded-md px-4 py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Start new scan
            </button>
          </>
        )}
      </div>

      {anyPageProcessing && pages.length > 0 && !pdfBlob && (
        <p className="text-sm text-zinc-500">Finishing page processing…</p>
      )}
      {saveNotice && (
        <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
          {saveNotice}
        </p>
      )}
      {!user && pdfBlob && (
        <p className="text-sm text-zinc-500">
          Guest scans aren&apos;t saved automatically -- download now, or sign in to keep a copy.
        </p>
      )}

      {editingPage && (
        <PageEditor
          page={editingPage}
          index={editingIndex}
          onClose={() => setEditingPageId(null)}
          onRotate={handleEditorRotate}
          onToggleCrop={handleEditorToggleCrop}
          onEnhancementChange={handleEditorEnhancementChange}
          onResetToOriginal={handleEditorReset}
          onRemove={() => handleRemovePage(editingPage.id)}
          onExtractText={ocrEnabled ? handleExtractPageText : undefined}
          extractTextDisabled={ocr.running}
        />
      )}

      {ocrEnabled && ocr.panelOpen && <OcrPanel ocr={ocr} pages={pages} />}
    </div>
  );
}

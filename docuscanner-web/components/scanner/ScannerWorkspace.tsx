"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Icon } from "@/components/ui/icons";
import { PrintButton } from "@/components/print/PrintButton";
import { useArmedDocument } from "@/components/print/useArmedDocument";
import { fileToCapturedImage, type CapturedImage } from "@/utils/scanner/image";
import type { Quad } from "@/utils/scanner/geometry";
import { createInitialPage, type PageRotation, type ScannerPage } from "@/utils/scanner/page";
import { detectPageQuad, renderPage } from "@/utils/scanner/pageProcessing";
import { createPdfFromPages } from "@/utils/scanner/pdf";
import { downloadBlob } from "@/utils/convert/download";
import { scannerPagesToPrintPages } from "@/utils/print/sources";
import { importPdfPages } from "@/utils/scanner/pdfImport";
import type { Annotation, AnnotationTool } from "@/utils/scanner/annotations";
import { remapAnnotations, type PageGeometry } from "@/utils/scanner/annotationRemap";
import { annotationContentBounds } from "@/utils/scanner/annotationRender";
import type { SignatureImage } from "@/utils/scanner/signature";
import { PdfError } from "@/utils/pdf/pdfjs";
import { validateImageFile } from "@/utils/scanner/validation";
import { classifyDocument, DOCUMENT_ACCEPT, SUPPORTED_FORMATS } from "@/utils/scanner/documentTypes";
import { takePendingImport } from "@/utils/scanner/handoff";
import { excelErrorMessage, wordErrorMessage } from "@/utils/convert/errorMessages";
import { cameraErrorMessage, pdfImportErrorMessage, uploadErrorMessage } from "@/utils/scanner/errorMessages";
import { saveDocumentToAccount } from "@/utils/documents/save";
import { getUserPlan, isFeatureAvailable } from "@/utils/features/plans";
import type { EnhancementMode } from "@/utils/scanner/enhance";
import {
  trackConversionCompleted,
  trackConversionStarted,
  trackDocumentCreated,
  trackDocumentDownloaded,
  trackDocumentUploaded,
  trackError,
  trackFeatureUsed,
  trackScanCompleted,
  trackScanStarted,
  trackSignPdf,
} from "@/utils/analytics/events";
import { CameraCapture } from "./CameraCapture";
import { PageList } from "./PageList";
import { PageEditor } from "./PageEditor";
import { PagePreview } from "./PagePreview";
import { WorkspaceStepper, type WorkspaceStep } from "./WorkspaceStepper";
import { CropEditor } from "./CropEditor";
import { ErrorBanner } from "./ErrorBanner";
import { OcrPanel } from "./OcrPanel";
import { useOcr } from "./useOcr";

// The annotation editor (toolbar, drawing surface, signature dialog) is only
// needed once someone taps Annotate, so it loads on demand instead of adding to
// the scanner's first load.
const AnnotationEditor = dynamic(() => import("./AnnotationEditor").then((m) => m.AnnotationEditor), {
  ssr: false,
  loading: () => null,
});

type Mode = "idle" | "camera";

// Set when the workspace is opened from a Tools entry (Sign PDF, Highlight ...):
// which annotation tool to start with, and which signature method to show first.
export interface EditorIntent {
  tool: AnnotationTool | null;
  signatureTab?: "draw" | "upload";
  guide?: string;
}

// A page whose detected boundary covers at least this much confidence gets
// auto-cropped by default; below it we keep the original framing rather
// than force a bad crop, per requirement C.
const AUTO_CROP_CONFIDENCE_THRESHOLD = 0.55;

function geometryOf(
  page: Pick<ScannerPage, "originalWidth" | "originalHeight" | "quad" | "cropEnabled" | "rotation">,
): PageGeometry {
  return {
    originalWidth: page.originalWidth,
    originalHeight: page.originalHeight,
    quad: page.quad,
    cropEnabled: page.cropEnabled,
    rotation: page.rotation,
  };
}

// Where a page's marks belong after a crop/rotation change, so they stay on the
// same spot of the document instead of the same spot of the screen.
function annotationsForChange(
  page: ScannerPage,
  change: Partial<Pick<ScannerPage, "quad" | "cropEnabled" | "rotation">>,
): Annotation[] {
  return remapAnnotations(page.annotations, geometryOf(page), geometryOf({ ...page, ...change }), annotationContentBounds);
}

export function ScannerWorkspace({ initialMode, intent }: { initialMode?: "camera" | "upload"; intent?: EditorIntent }) {
  const { user, openAuthModal } = useAuth();
  // Derive the starting mode directly from the prop instead of setting it
  // from an effect -- avoids an extra render and a setState-in-effect.
  const [mode, setMode] = useState<Mode>(initialMode === "camera" ? "camera" : "idle");
  const [pages, setPages] = useState<ScannerPage[]>([]);
  // The page shown large in the preview. Falls back to the first page when unset or removed.
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [croppingPageId, setCroppingPageId] = useState<string | null>(null);
  const [annotatingPageId, setAnnotatingPageId] = useState<string | null>(null);
  // A Tools entry opens the annotator by itself for a single-page document, once;
  // after that (or with several pages) the person picks a page as usual.
  const [intentUsed, setIntentUsed] = useState(false);
  // The most recent signature, kept in memory only so it can be placed on more
  // pages without redrawing. Never stored or uploaded; gone on reload.
  const [lastSignature, setLastSignature] = useState<SignatureImage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pdfImport, setPdfImport] = useState<{ done: number; total: number } | null>(null);
  // Set while a Word/Excel/CSV file is being converted to PDF before import.
  const [importStage, setImportStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [creatingPdf, setCreatingPdf] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const plan = getUserPlan(user);
  const ocrEnabled = isFeatureAvailable("ocr.basic", plan);
  const ocr = useOcr(plan);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLElement>(null);
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
      const withDetection: ScannerPage = { ...page, quad, detectedQuad: quad, quadConfidence: confidence, cropEnabled };
      updatePageFields(page.id, {
        quad,
        detectedQuad: quad,
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
      // Any edit makes a previously generated PDF out of date.
      setPdfBlob(null);
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
          // The crop couldn't be applied, so the page is really uncropped:
          // put the marks back where that puts them.
          updatePageFields(page.id, {
            cropEnabled: false,
            annotations: annotationsForChange(target, { cropEnabled: false }),
          });
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
    setPdfBlob(null);
    setPages((prev) => [...prev, initial]);
    // Show what was just captured.
    setSelectedPageId(initial.id);
    void runDetectionAndRender(initial);
  }

  // Renders each page of a PDF into the workspace, so it can be cropped,
  // rotated, enhanced, annotated and reordered like any scanned photo. `track`
  // is false for a PDF this app just made from a Word/Excel file, which was
  // already counted as an upload of the original.
  async function importPdf(file: File, track = true) {
    setPdfImport({ done: 0, total: 0 });
    try {
      markScanStarted("upload");
      if (track) void trackDocumentUploaded(file.type || "application/pdf", file.size);
      const count = await importPdfPages(file, {
        onPage: (captured, pageNumber, pageCount) => {
          setPdfBlob(null);
          setPages((prev) => [...prev, createInitialPage(captured, { skipDetection: true })]);
          setPdfImport({ done: pageNumber, total: pageCount });
        },
      });
      void trackFeatureUsed("pdf_import", { pageCount: count });
    } catch (err) {
      const code = err instanceof PdfError ? err.code : "pdf_failed";
      setError(pdfImportErrorMessage(code));
      void trackError("pdf_import", code);
    } finally {
      setPdfImport(null);
    }
  }

  // Word, Excel and CSV files are converted to a PDF in the browser first, then
  // opened as pages like any other PDF -- so they can be edited and signed too.
  // The converters are large and load only when a file of that type is chosen.
  async function importConverted(file: File, kind: "docx" | "spreadsheet" | "csv") {
    const conversion = kind === "docx" ? "word_to_pdf" : "spreadsheet_to_pdf";
    setImportStage(kind === "docx" ? "Converting Word document\u2026" : "Converting spreadsheet\u2026");
    const startedAt = Date.now();
    void trackDocumentUploaded(file.type || "application/octet-stream", file.size);
    void trackConversionStarted(conversion);

    let pdf: File;
    try {
      let blob: Blob;
      let warnings: string[];
      if (kind === "docx") {
        const { convertDocxToPdf } = await import("@/utils/convert/wordToPdf");
        ({ blob, warnings } = await convertDocxToPdf(file));
      } else {
        const { loadWorkbook, workbookToPdf } = await import("@/utils/convert/excelToPdf");
        const loaded = await loadWorkbook(file);
        const sheetNames = loaded.sheets.filter((sheet) => sheet.rows > 0).map((sheet) => sheet.name);
        ({ blob, warnings } = await workbookToPdf(loaded, { sheetNames, orientation: "auto", showGridlines: true }));
      }
      pdf = new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "document"}.pdf`, { type: "application/pdf" });
      if (warnings.length > 0) setNotice(warnings.join(" "));
      void trackConversionCompleted(conversion, Date.now() - startedAt);
    } catch (err) {
      // Both converters throw errors that carry a short code; the copy is shared
      // with the dedicated tools.
      const code =
        typeof err === "object" && err && "code" in err && typeof err.code === "string" ? err.code : "conversion_failed";
      setError(kind === "docx" ? wordErrorMessage(code) : excelErrorMessage(code));
      void trackError(conversion, code);
      setImportStage(null);
      return;
    }
    // Starting the import first means there is no gap where the workspace looks idle.
    const imported = importPdf(pdf, false);
    setImportStage(null);
    await imported;
  }

  // Sends one chosen file down the right path for its type.
  async function importDocument(file: File) {
    const kind = classifyDocument(file);
    if (kind === "pdf") return importPdf(file);
    if (kind === "docx" || kind === "spreadsheet" || kind === "csv") return importConverted(file, kind);
    if (kind === "legacy-word" || kind === "legacy-excel" || kind === "unknown") {
      const reason =
        kind === "legacy-word" ? "legacy_word" : kind === "legacy-excel" ? "legacy_excel" : "unsupported_file_type";
      setError(uploadErrorMessage(reason));
      void trackError("upload", reason);
      return;
    }

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(uploadErrorMessage(validationError));
      void trackError("upload", validationError);
      return;
    }
    try {
      const captured = await fileToCapturedImage(file);
      const initial = createInitialPage(captured);
      setPdfBlob(null);
      setPages((prev) => [...prev, initial]);
      markScanStarted("upload");
      void trackDocumentUploaded(file.type, file.size);
      void runDetectionAndRender(initial);
    } catch {
      setError(uploadErrorMessage("image_decode_failed"));
      void trackError("upload", "image_decode_failed");
    }
  }

  async function processFiles(files: File[]) {
    for (const file of files) await importDocument(file);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file later
    if (files.length === 0) return;
    await processFiles(files);
  }

  useEffect(() => {
    // A PDF handed over from a converter tool ("Edit & sign this PDF"). It comes
    // from this tab's memory only, and is opened like any uploaded file. Deferred
    // a tick so nothing is set synchronously inside the effect.
    const handedOff = takePendingImport();
    if (handedOff.length > 0) void Promise.resolve().then(() => processFiles(handedOff));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRemovePage(id: string) {
    setPdfBlob(null);
    // Keep the preview on a neighbouring page when the shown one goes.
    if (selectedPage?.id === id) {
      const at = pages.findIndex((p) => p.id === id);
      setSelectedPageId((pages[at + 1] ?? pages[at - 1])?.id ?? null);
    }
    setPages((prev) => prev.filter((p) => p.id !== id));
    setEditingPageId((current) => (current === id ? null : current));
    setCroppingPageId((current) => (current === id ? null : current));
    setAnnotatingPageId((current) => (current === id ? null : current));
    void trackFeatureUsed("remove_page");
  }

  function handleMovePage(id: string, direction: "up" | "down") {
    setPdfBlob(null);
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

  const selectedPage = pages.find((p) => p.id === selectedPageId) ?? pages[0] ?? null;
  const selectedIndex = selectedPage ? pages.indexOf(selectedPage) : -1;
  const editingPage = pages.find((p) => p.id === editingPageId) ?? null;
  const editingIndex = editingPage ? pages.findIndex((p) => p.id === editingPage.id) : -1;

  function handleEditorRotate(direction: "left" | "right") {
    if (!editingPage) return;
    const delta = direction === "right" ? 90 : -90;
    const rotation = ((((editingPage.rotation + delta) % 360) + 360) % 360) as PageRotation;
    void trackFeatureUsed("rotate_page");
    void reprocessPage(editingPage, { rotation, annotations: annotationsForChange(editingPage, { rotation }) });
  }

  function handleEditorToggleCrop() {
    if (!editingPage) return;
    const cropEnabled = !editingPage.cropEnabled;
    if (cropEnabled) {
      void trackFeatureUsed("auto_crop");
      void trackFeatureUsed("perspective_correction");
    }
    void reprocessPage(editingPage, { cropEnabled, annotations: annotationsForChange(editingPage, { cropEnabled }) });
  }

  function handleEditorEnhancementChange(enhancement: EnhancementMode) {
    if (!editingPage || editingPage.enhancement === enhancement) return;
    if (enhancement !== "original") void trackFeatureUsed("enhancement");
    void reprocessPage(editingPage, { enhancement });
  }

  function handleEditorAdjustmentChange(patch: { brightness?: number; contrast?: number }) {
    if (!editingPage) return;
    void trackFeatureUsed("brightness_contrast");
    void reprocessPage(editingPage, patch);
  }

  function handleEditorReset() {
    if (!editingPage) return;
    const reset = {
      cropEnabled: false,
      // Back to what auto-detection found, discarding any manual crop.
      quad: editingPage.detectedQuad,
      rotation: 0 as PageRotation,
    };
    void reprocessPage(editingPage, {
      annotations: annotationsForChange(editingPage, reset),
      ...reset,
      enhancement: "original",
      brightness: 0,
      contrast: 0,
    });
  }

  const croppingPage = pages.find((p) => p.id === croppingPageId) ?? null;

  function handleCropApply(quad: Quad) {
    if (!croppingPage) return;
    const page = croppingPage;
    setCroppingPageId(null);
    void trackFeatureUsed("manual_crop");
    void reprocessPage(page, { quad, cropEnabled: true, annotations: annotationsForChange(page, { quad, cropEnabled: true }) });
  }

  const autoOpenId =
    intent?.tool && !intentUsed && pages.length === 1 && pages[0].status === "ready" && !editingPageId && !croppingPageId
      ? pages[0].id
      : null;
  const annotatingPage = pages.find((p) => p.id === (annotatingPageId ?? autoOpenId)) ?? null;
  const annotatingIndex = annotatingPage ? pages.findIndex((p) => p.id === annotatingPage.id) : -1;

  function handleAnnotationsDone(annotations: Annotation[]) {
    if (!annotatingPage) return;
    const page = annotatingPage;
    setAnnotatingPageId(null);
    setIntentUsed(true);
    // Nothing changed: leave the page (and any PDF already made) alone.
    if (annotations === page.annotations) return;
    // The PDF made earlier no longer matches this page.
    setPdfBlob(null);
    updatePageFields(page.id, { annotations });
  }

  const anyPageProcessing =
    pdfImport !== null || importStage !== null || pages.some((p) => p.status === "detecting" || p.status === "processing");

  // Whatever the browser's print command is used from, it prints these pages (as
  // edited) and nothing else on the screen.
  useArmedDocument({
    hasDocument: pages.length > 0,
    active: !anyPageProcessing,
    docKey: pages,
    title: "document",
    load: () => scannerPagesToPrintPages(pages),
  });

  // On a phone the Export card sits below the preview: when the PDF is ready, make sure
  // the result (and its Download button) is what's on screen.
  useEffect(() => {
    if (pdfBlob) exportRef.current?.scrollIntoView({ block: "nearest" });
  }, [pdfBlob]);

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
      const signatures = pages.reduce((n, p) => n + p.annotations.filter((a) => a.type === "signature").length, 0);
      if (signatures > 0) void trackSignPdf(signatures);
    } catch {
      setError("Couldn't create the PDF. Please try again.");
      void trackError("pdf_generation", "pdf_generation_failed");
    } finally {
      setCreatingPdf(false);
    }
  }

  function handleDownload() {
    if (!pdfBlob) return;
    downloadBlob(pdfBlob, "document.pdf");
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
    setSelectedPageId(null);
    setEditingPageId(null);
    setCroppingPageId(null);
    setAnnotatingPageId(null);
    setIntentUsed(false);
    setNotice(null);
    setPdfBlob(null);
    setSaveNotice(null);
    setError(null);
    scanStartedRef.current = false;
    scanCompletedRef.current = false;
  }

  // Camera first when scanning; upload first when a Tools entry (Sign PDF ...) opened this.
  const addButtons = (large: boolean) => (
    <>
      <button
        type="button"
        onClick={handleOpenCamera}
        className={`btn ${large ? `btn-lg ${intent ? "btn-secondary order-2" : "btn-primary"}` : "btn-secondary"}`}
      >
        <Icon name="camera" size={20} />
        Use camera
      </button>
      <button
        type="button"
        onClick={handleUploadClick}
        className={`btn ${large ? `btn-lg ${intent ? "btn-primary order-1" : "btn-secondary"}` : "btn-secondary"}`}
      >
        <Icon name="upload" size={20} />
        Upload document
      </button>
    </>
  );

  const step: WorkspaceStep = pages.length === 0 ? 0 : pdfBlob ? 2 : 1;
  const busyMessage = importStage
    ? importStage
    : pdfImport
      ? pdfImport.total > 0
        ? `Importing PDF… page ${pdfImport.done} of ${pdfImport.total}`
        : "Opening PDF…"
      : null;

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        multiple
        onChange={handleFileChange}
        className="sr-only"
        aria-label="Upload a document: PDF, Word, Excel, CSV or image"
      />

      <WorkspaceStepper current={step} />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <div role="status" className="notice notice-warning">
          <span className="min-w-0 flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notice"
            className="btn btn-icon btn-ghost -my-2 -mr-2 shrink-0"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      )}
      {busyMessage && (
        <p role="status" className="notice notice-info">
          {busyMessage}
        </p>
      )}

      {mode === "camera" && (
        <CameraCapture onCapture={handleCameraCapture} onClose={() => setMode("idle")} onError={handleCameraError} />
      )}

      {mode !== "camera" && pages.length === 0 && (
        <section
          aria-labelledby="scan-empty-title"
          className="card flex flex-col items-center gap-5 px-4 py-10 text-center sm:py-16"
        >
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
          >
            <Icon name="document" size={28} />
          </span>
          <div>
            <h2 id="scan-empty-title" className="section-title">
              Add your first page
            </h2>
            <p className="muted mx-auto mt-1 max-w-md text-sm">
              Take a photo of a document, or upload a file. You can crop, enhance and sign each page, then export one PDF.
            </p>
          </div>
          <div className="flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">{addButtons(true)}</div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{SUPPORTED_FORMATS}</p>
        </section>
      )}

      {pages.length > 0 && selectedPage && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="min-w-0 space-y-3">
            <PagePreview
              page={selectedPage}
              index={selectedIndex}
              total={pages.length}
              onEdit={() => setEditingPageId(selectedPage.id)}
              onPrevious={() => setSelectedPageId(pages[selectedIndex - 1]?.id ?? null)}
              onNext={() => setSelectedPageId(pages[selectedIndex + 1]?.id ?? null)}
            />
            <PageList pages={pages} selectedId={selectedPage.id} onSelect={setSelectedPageId} />
          </div>

          <div className="min-w-0 space-y-4">
            <section aria-label="This page" className="card space-y-3 p-4">
              <h2 className="panel-title">Page {selectedIndex + 1}</h2>
              <button type="button" onClick={() => setEditingPageId(selectedPage.id)} className="btn btn-secondary w-full">
                <Icon name="crop" size={18} />
                Edit page
              </button>
              <p className="muted text-xs">Crop, rotate, enhance, add text or sign.</p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleMovePage(selectedPage.id, "up")}
                  disabled={selectedIndex === 0}
                  aria-label={`Move page ${selectedIndex + 1} earlier`}
                  title="Move earlier"
                  className="btn btn-secondary"
                >
                  <Icon name="arrow-up" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => handleMovePage(selectedPage.id, "down")}
                  disabled={selectedIndex === pages.length - 1}
                  aria-label={`Move page ${selectedIndex + 1} later`}
                  title="Move later"
                  className="btn btn-secondary"
                >
                  <Icon name="arrow-down" size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => handleRemovePage(selectedPage.id)}
                  aria-label={`Remove page ${selectedIndex + 1}`}
                  title="Remove page"
                  className="btn btn-danger"
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </section>

            <section ref={exportRef} aria-label="Export" className="card space-y-3 p-4">
              <h2 className="panel-title">Export</h2>
              {pdfBlob && (
                <div role="status" className="notice notice-success">
                  <Icon name="check" size={18} className="mt-0.5" />
                  <span>
                    <strong className="block">Your PDF is ready</strong>
                    {pages.length} page{pages.length === 1 ? "" : "s"}. Download it, print it or save it to your account.
                  </span>
                </div>
              )}

              {pdfBlob ? (
                <button type="button" onClick={handleDownload} className="btn btn-primary btn-lg w-full">
                  <Icon name="download" size={20} />
                  Download PDF
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreatePdf}
                  disabled={pages.length === 0 || creatingPdf || anyPageProcessing}
                  className="btn btn-primary btn-lg w-full"
                >
                  {creatingPdf ? "Preparing PDF…" : `Create PDF (${pages.length} page${pages.length === 1 ? "" : "s"})`}
                </button>
              )}
              {!pdfBlob && anyPageProcessing && !pdfImport && (
                <p role="status" className="muted text-sm">
                  Finishing page processing…
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <PrintButton
                  source="scan"
                  title="document"
                  disabled={anyPageProcessing}
                  className="btn btn-secondary flex-1"
                  getPages={() => scannerPagesToPrintPages(pages)}
                />
                {pdfBlob && (
                  <button
                    type="button"
                    onClick={handleSaveToAccount}
                    disabled={saving}
                    className="btn btn-secondary flex-1 whitespace-nowrap"
                  >
                    <Icon name="save" size={18} />
                    {saving ? "Saving…" : "Save to account"}
                  </button>
                )}
              </div>

              {ocrEnabled && (
                <details className="group border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <summary className="btn btn-ghost w-full cursor-pointer list-none justify-between">
                    More options
                    <Icon name="chevron-down" size={18} className="transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleExtractAllText}
                      disabled={pages.length === 0 || anyPageProcessing || ocr.running}
                      className="btn btn-secondary"
                    >
                      <Icon name="ocr" size={18} />
                      {pages.length > 1 ? `Extract text (${pages.length} pages)` : "Extract text"}
                    </button>
                    {ocr.hasResult && !ocr.panelOpen && (
                      <button type="button" onClick={ocr.openPanel} className="btn btn-secondary">
                        View extracted text
                      </button>
                    )}
                  </div>
                </details>
              )}

              {saveNotice && (
                <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
                  {saveNotice}
                </p>
              )}
              {!user && pdfBlob && (
                <p className="muted text-sm">
                  Guest scans aren&apos;t saved automatically. Download now, or sign in to keep a copy.
                </p>
              )}
              {pdfBlob && (
                <button type="button" onClick={handleStartOver} className="btn btn-ghost w-full">
                  Start new scan
                </button>
              )}
            </section>

            {mode !== "camera" && (
              <section aria-label="Add pages" className="card space-y-3 p-4">
                <h2 className="panel-title">Add more pages</h2>
                <div className="flex flex-col gap-2">{addButtons(false)}</div>
              </section>
            )}
          </div>
        </div>
      )}

      {editingPage && (
        <PageEditor
          page={editingPage}
          index={editingIndex}
          onClose={() => setEditingPageId(null)}
          onRotate={handleEditorRotate}
          onAdjustCrop={() => setCroppingPageId(editingPage.id)}
          onAnnotate={() => setAnnotatingPageId(editingPage.id)}
          onToggleCrop={handleEditorToggleCrop}
          onEnhancementChange={handleEditorEnhancementChange}
          onAdjustmentChange={handleEditorAdjustmentChange}
          onResetToOriginal={handleEditorReset}
          onRemove={() => handleRemovePage(editingPage.id)}
          onExtractText={ocrEnabled ? handleExtractPageText : undefined}
          extractTextDisabled={ocr.running}
        />
      )}

      {annotatingPage && (
        <AnnotationEditor
          key={annotatingPage.id}
          page={annotatingPage}
          index={annotatingIndex}
          lastSignature={lastSignature}
          onSignatureUsed={setLastSignature}
          onTrack={(feature) => void trackFeatureUsed(feature)}
          onDone={handleAnnotationsDone}
          initialTool={intent?.tool}
          initialSignatureTab={intent?.signatureTab}
        />
      )}

      {croppingPage && (
        <CropEditor page={croppingPage} onApply={handleCropApply} onCancel={() => setCroppingPageId(null)} />
      )}

      {ocrEnabled && ocr.panelOpen && <OcrPanel ocr={ocr} pages={pages} />}
    </div>
  );
}

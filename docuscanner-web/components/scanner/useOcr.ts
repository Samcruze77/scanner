"use client";

// OCR state + actions for the scanner workspace. Kept out of ScannerWorkspace
// on purpose: OCR is an add-on, and everything here is isolated so that a
// failure (engine won't load, timeout, out of memory) can only ever end up in
// `state` -- it can't reach scanning, editing or PDF creation.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanId } from "@/utils/features/plans";
import { getOcrLimits } from "@/utils/ocr/config";
import { copyTextToClipboard, downloadTextFile } from "@/utils/ocr/export";
import { isOcrResultStale } from "@/utils/ocr/preprocess";
import { runOcr } from "@/utils/ocr/run";
import {
  OcrCancelledError,
  OcrError,
  type OcrDocumentResult,
  type OcrErrorCode,
  type OcrProgress,
} from "@/utils/ocr/types";
import type { ScannerPage } from "@/utils/scanner/page";
import { trackDocumentDownloaded, trackError, trackFeatureUsed } from "@/utils/analytics/events";

export type OcrScope = { kind: "document" } | { kind: "page"; pageId: string };

export type OcrState =
  | { status: "idle" }
  | { status: "running"; progress: OcrProgress | null }
  | { status: "done"; result: OcrDocumentResult; errorCodes: OcrErrorCode[] }
  | { status: "error"; code: OcrErrorCode };

export type OcrController = ReturnType<typeof useOcr>;

const TEXT_FILENAME = "extracted-text.txt";

export function useOcr(plan: PlanId) {
  const limits = getOcrLimits(plan);
  const [state, setState] = useState<OcrState>({ status: "idle" });
  // The user's working copy; starts as the combined engine output and is
  // what copy/download/search operate on.
  const [text, setText] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<{ pages: ScannerPage[]; scope: OcrScope } | null>(null);

  useEffect(() => {
    const abort = abortRef;
    return () => abort.current?.abort();
  }, []);

  const start = useCallback(
    async (pages: ScannerPage[], scope: OcrScope) => {
      // One run at a time; a second click while running is a no-op, which is
      // also what keeps the usage event to exactly one per run.
      if (abortRef.current) return;

      const targets = pages
        .map((page, index) => ({ page, pageNumber: index + 1 }))
        .filter(({ page }) => scope.kind === "document" || page.id === scope.pageId);
      if (targets.length === 0) return;

      lastRunRef.current = { pages, scope };
      setPanelOpen(true);

      if (targets.length > limits.maxPagesPerRun) {
        setState({ status: "error", code: "too_many_pages" });
        void trackError("ocr", "too_many_pages");
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setState({ status: "running", progress: null });
      void trackFeatureUsed("ocr", { tier: "basic", scope: scope.kind, pageCount: targets.length });

      try {
        const outcome = await runOcr({
          targets,
          scope: scope.kind,
          limits,
          signal: controller.signal,
          onProgress: (progress) => {
            if (abortRef.current !== controller) return;
            setState((prev) => (prev.status === "running" ? { status: "running", progress } : prev));
          },
        });
        if (abortRef.current !== controller) return;
        setText(outcome.result.documentText);
        setState({ status: "done", result: outcome.result, errorCodes: outcome.errorCodes });
        for (const code of outcome.errorCodes) void trackError("ocr", code);
      } catch (error) {
        if (error instanceof OcrCancelledError || abortRef.current !== controller) return;
        const code: OcrErrorCode = error instanceof OcrError ? error.code : "ocr_failed";
        setState({ status: "error", code });
        void trackError("ocr", code);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [limits],
  );

  const retry = useCallback(() => {
    const last = lastRunRef.current;
    if (last) void start(last.pages, last.scope);
  }, [start]);

  // Re-read the same pages/scope against the workspace's current pages, for
  // when the result went stale after edits.
  const rerun = useCallback(
    (pages: ScannerPage[]) => {
      const previous = lastRunRef.current?.scope;
      const scope: OcrScope =
        previous?.kind === "page" && pages.some((p) => p.id === previous.pageId) ? previous : { kind: "document" };
      void start(pages, scope);
    },
    [start],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState({ status: "idle" });
    setText("");
    setPanelOpen(false);
  }, [cancel]);

  // Closing hides a finished result (it can be reopened); anything else --
  // a running job, an error, or a "no text found" result -- is dropped.
  const closePanel = useCallback(() => {
    const keepable = state.status === "done" && state.result.pages.some((p) => p.text);
    if (keepable) setPanelOpen(false);
    else reset();
  }, [state, reset]);

  const openPanel = useCallback(() => setPanelOpen(true), []);

  const restoreOriginalText = useCallback(() => {
    if (state.status === "done") setText(state.result.documentText);
  }, [state]);

  const copy = useCallback(async () => {
    const ok = await copyTextToClipboard(text);
    if (ok) void trackFeatureUsed("ocr_copy");
    return ok;
  }, [text]);

  const download = useCallback(() => {
    downloadTextFile(text, TEXT_FILENAME);
    void trackDocumentDownloaded("txt");
  }, [text]);

  const isStale = useCallback(
    (pages: ScannerPage[]) => state.status === "done" && isOcrResultStale(state.result, pages),
    [state],
  );

  return {
    state,
    text,
    setText,
    panelOpen,
    limits,
    running: state.status === "running",
    hasResult: state.status === "done" && state.result.pages.some((p) => p.text),
    start,
    retry,
    rerun,
    reset,
    closePanel,
    openPanel,
    restoreOriginalText,
    copy,
    download,
    isStale,
  };
}

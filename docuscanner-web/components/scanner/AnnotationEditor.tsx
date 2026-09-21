"use client";

// Full-screen editor for adding text, pen drawings, highlights, check marks,
// crosses, dates and signatures on top of a page. Opened from the page editor,
// like the crop editor. Works on a private copy of the page's annotations with
// its own undo/redo history and hands the result back on Done, so nothing
// changes on the page until then.

import { Icon, type IconName } from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";
import {
  clamp,
  createSignature,
  DEFAULT_TEXT_PT,
  HIGHLIGHT_PALETTE,
  MAX_TEXT_PT,
  MIN_TEXT_PT,
  PALETTE,
  PEN_WIDTHS,
  ptToSize,
  sizeToPt,
  type Annotation,
  type AnnotationTool,
} from "@/utils/scanner/annotations";
import { loadAnnotationImage } from "@/utils/scanner/annotationRender";
import type { ScannerPage } from "@/utils/scanner/page";
import type { SignatureImage } from "@/utils/scanner/signature";
import { AnnotationCanvas, type AnnotationDefaults } from "./AnnotationCanvas";
import { SignatureDialog, type Tab as SignatureTab } from "./SignatureDialog";
import { useZoom, ZoomControls, ZoomFrame, ZoomViewport } from "./zoom";

const TOOLS: { value: AnnotationTool; label: string; icon: IconName }[] = [
  { value: "select", label: "Select", icon: "pointer" },
  { value: "text", label: "Text", icon: "text" },
  { value: "draw", label: "Draw", icon: "pen" },
  { value: "highlight", label: "Highlight", icon: "highlight" },
  { value: "check", label: "Check", icon: "check" },
  { value: "cross", label: "X", icon: "x" },
  { value: "date", label: "Date", icon: "calendar" },
  { value: "signature", label: "Signature", icon: "signature" },
];

const HINTS: Record<AnnotationTool, string> = {
  select: "Tap a mark to move it. Drag its corner dot to resize.",
  text: "Tap the page where you want to type.",
  draw: "Draw on the page with your finger or mouse.",
  highlight: "Drag across the area you want to highlight.",
  check: "Tap the page to place a check mark.",
  cross: "Tap the page to place an X.",
  date: "Tap the page to place today's date.",
  signature: "",
};

const MAX_HISTORY = 100;

interface History {
  past: Annotation[][];
  present: Annotation[];
  future: Annotation[][];
}

export function AnnotationEditor({
  page,
  index,
  lastSignature,
  onSignatureUsed,
  onTrack,
  onDone,
  initialTool,
  initialSignatureTab,
}: {
  page: ScannerPage;
  index: number;
  lastSignature: SignatureImage | null;
  onSignatureUsed: (signature: SignatureImage) => void;
  onTrack: (feature: string) => void;
  onDone: (annotations: Annotation[]) => void;
  // Set when the editor is opened from a Tools entry such as Sign PDF or Highlight.
  initialTool?: AnnotationTool | null;
  initialSignatureTab?: "draw" | "upload";
}) {
  const [history, setHistory] = useState<History>({ past: [], present: page.annotations, future: [] });
  // A gesture or text edit in progress. Shown, but not in the history until it
  // ends, so undo steps over whole actions rather than every pen sample.
  const [live, setLive] = useState<Annotation[] | null>(null);
  const [tool, setTool] = useState<AnnotationTool>(initialTool && initialTool !== "signature" ? initialTool : "select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(initialTool === "signature");

  const [color, setColor] = useState<string>(PALETTE[0]);
  const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_PALETTE[0]);
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS[1].value);
  const [textPt, setTextPt] = useState(DEFAULT_TEXT_PT);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);

  const firstToolRef = useRef<HTMLButtonElement>(null);
  const zoom = useZoom();
  const annotations = live ?? history.present;
  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  const defaults: AnnotationDefaults = { color, highlightColor, penWidth, text: { pt: textPt, color, bold, italic } };

  // ---- history ----------------------------------------------------------------

  function commit(next: Annotation[]) {
    const added = next.filter((n) => !history.present.some((p) => p.id === n.id));
    added.forEach((a) => onTrack(`annotation_${a.type}`));
    setHistory((h) => ({ past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [] }));
    setLive(null);
  }

  function finishEditing() {
    if (!editingId) return;
    const id = editingId;
    setEditingId(null);
    if (!live) return;
    const text = live.find((a) => a.id === id);
    const before = history.present.find((a) => a.id === id);
    if (!text || text.type !== "text" || text.text.trim() === "") {
      // Emptied (or never filled in): the box goes away.
      if (before) commit(live.filter((a) => a.id !== id));
      else setLive(null);
      setSelectedId(null);
      return;
    }
    if (before?.type === "text" && before.text === text.text) setLive(null);
    else commit(live);
  }

  function undo() {
    finishEditing();
    setHistory((h) =>
      h.past.length === 0
        ? h
        : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] },
    );
    setSelectedId(null);
  }

  function redo() {
    finishEditing();
    setHistory((h) =>
      h.future.length === 0
        ? h
        : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) },
    );
    setSelectedId(null);
  }

  function deleteSelected() {
    if (!selectedId) return;
    setEditingId(null);
    commit(annotations.filter((a) => a.id !== selectedId));
    setSelectedId(null);
  }

  // The list to save if the editor closes right now, including any half-typed
  // text (empty text boxes are dropped).
  function resolveFinal(): Annotation[] {
    if (!live) return history.present;
    const text = editingId ? live.find((a) => a.id === editingId) : null;
    if (editingId && (!text || text.type !== "text" || text.text.trim() === "")) {
      return live.filter((a) => a.id !== editingId);
    }
    return live;
  }

  // ---- tools & properties -------------------------------------------------------

  function chooseTool(next: AnnotationTool) {
    finishEditing();
    if (next === "signature") {
      setSignatureOpen(true);
      return;
    }
    setTool(next);
    if (next !== "select") setSelectedId(null);
  }

  // Edits the selected mark if there is one, otherwise just sets the default
  // for the next one. While a text box is open its edits go to the live copy.
  function patchSelected(patch: (a: Annotation) => Annotation) {
    if (!selected) return;
    const next = annotations.map((a) => (a.id === selected.id ? patch(a) : a));
    if (live) setLive(next);
    else commit(next);
  }

  function applyColor(value: string) {
    setColor(value);
    if (selected && (selected.type === "text" || selected.type === "ink" || selected.type === "check" || selected.type === "cross")) {
      patchSelected((a) => ({ ...a, color: value }) as Annotation);
    }
  }

  function applyHighlightColor(value: string) {
    setHighlightColor(value);
    if (selected?.type === "highlight") patchSelected((a) => ({ ...a, color: value }) as Annotation);
  }

  function applyPenWidth(value: number) {
    setPenWidth(value);
    if (selected?.type === "ink") patchSelected((a) => ({ ...a, width: value }) as Annotation);
  }

  const shownPt = selected?.type === "text" ? sizeToPt(selected.size) : textPt;
  const shownBold = selected?.type === "text" ? selected.bold : bold;
  const shownItalic = selected?.type === "text" ? selected.italic : italic;

  function applyPt(pt: number) {
    const value = clamp(pt, MIN_TEXT_PT, MAX_TEXT_PT);
    setTextPt(value);
    if (selected?.type === "text") patchSelected((a) => ({ ...a, size: ptToSize(value) }) as Annotation);
  }

  function applyBold(value: boolean) {
    setBold(value);
    if (selected?.type === "text") patchSelected((a) => ({ ...a, bold: value }) as Annotation);
  }

  function applyItalic(value: boolean) {
    setItalic(value);
    if (selected?.type === "text") patchSelected((a) => ({ ...a, italic: value }) as Annotation);
  }

  async function placeSignature(signature: SignatureImage, method?: SignatureTab) {
    setSignatureOpen(false);
    try {
      await loadAnnotationImage(signature.dataUrl);
    } catch {
      return;
    }
    const placed = createSignature(signature.dataUrl, signature.width, signature.height, page.processedWidth, page.processedHeight);
    commit([...annotations, placed]);
    setSelectedId(placed.id);
    setTool("select");
    onSignatureUsed(signature);
    if (method) onTrack(method === "draw" ? "signature_drawn" : method === "upload" ? "signature_uploaded" : "signature_typed");
  }

  // ---- keyboard -----------------------------------------------------------------

  useEffect(() => {
    firstToolRef.current?.focus();
  }, []);

  useEffect(() => {
    // Capture phase, so Escape and undo here don't also reach the page editor
    // underneath (which closes on Escape).
    function onKeyDown(e: KeyboardEvent) {
      if (signatureOpen) return;
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        if (editingId) finishEditing();
        else onDone(resolveFinal());
        return;
      }
      if (inField || editingId) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    // No dependency list on purpose: the handlers close over current state, so
    // the listener is re-registered after every render.
  });

  // ---- render ------------------------------------------------------------------

  const targetType =
    selected?.type ??
    (tool === "text" || tool === "date"
      ? "text"
      : tool === "draw"
        ? "ink"
        : tool === "highlight"
          ? "highlight"
          : tool === "check" || tool === "cross"
            ? "check"
            : null);
  const showText = targetType === "text";
  const showColor = targetType === "text" || targetType === "ink" || targetType === "check" || targetType === "cross";
  const showHighlightColors = targetType === "highlight";
  const showPen = targetType === "ink";
  const pageAspect = page.processedWidth / page.processedHeight;

  const chip = "flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border px-2 text-sm font-medium";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Annotate page ${index + 1}`}
      className="fixed inset-0 z-[60] flex flex-col bg-zinc-100 dark:bg-zinc-950"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-surface px-3 py-2 dark:border-zinc-800">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Annotate page {index + 1}</h2>
        <button
          type="button"
          onClick={undo}
          disabled={history.past.length === 0 && !live}
          aria-label="Undo"
          className={`${chip} border-zinc-300 disabled:opacity-40 dark:border-zinc-700`}
        >
          <Icon name="undo" size={18} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={history.future.length === 0}
          aria-label="Redo"
          className={`${chip} border-zinc-300 disabled:opacity-40 dark:border-zinc-700`}
        >
          <Icon name="redo" size={18} />
        </button>
        <button
          type="button"
          onClick={() => onDone(resolveFinal())}
          className="btn btn-primary"
        >
          Done
        </button>
      </div>

      <div
        role="toolbar"
        aria-label="Annotation tools"
        className="flex shrink-0 flex-wrap gap-1 border-b border-zinc-200 bg-surface px-3 py-2 dark:border-zinc-800"
      >
        {TOOLS.map((t, i) => (
          <button
            key={t.value}
            ref={i === 0 ? firstToolRef : undefined}
            type="button"
            aria-pressed={tool === t.value && t.value !== "signature"}
            onClick={() => chooseTool(t.value)}
            className={`${chip} gap-1.5 whitespace-nowrap ${
              tool === t.value && t.value !== "signature"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <Icon name={t.icon} size={18} />
            {t.label}
          </button>
        ))}
      </div>

      <div
        aria-label="Tool options"
        className="flex min-h-[60px] shrink-0 items-center gap-2 overflow-x-auto border-b border-zinc-200 bg-surface px-3 py-1 dark:border-zinc-800"
      >
        {showText && (
          <>
            <button type="button" aria-label="Smaller text" onClick={() => applyPt(shownPt - 2)} className={`${chip} border-zinc-300 dark:border-zinc-700`}>
              A−
            </button>
            <span className="w-12 shrink-0 text-center text-sm tabular-nums" aria-label="Font size">
              {shownPt} pt
            </span>
            <button type="button" aria-label="Larger text" onClick={() => applyPt(shownPt + 2)} className={`${chip} border-zinc-300 dark:border-zinc-700`}>
              A+
            </button>
            <button
              type="button"
              aria-label="Bold"
              aria-pressed={shownBold}
              onClick={() => applyBold(!shownBold)}
              className={`${chip} font-bold ${shownBold ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-zinc-300 dark:border-zinc-700"}`}
            >
              B
            </button>
            <button
              type="button"
              aria-label="Italic"
              aria-pressed={shownItalic}
              onClick={() => applyItalic(!shownItalic)}
              className={`${chip} italic ${shownItalic ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-zinc-300 dark:border-zinc-700"}`}
            >
              I
            </button>
          </>
        )}

        {showColor && (
          <div role="group" aria-label="Colour" className="flex shrink-0 items-center">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                aria-pressed={(selected && "color" in selected ? selected.color : color) === c}
                onClick={() => applyColor(c)}
                className="flex h-11 w-11 items-center justify-center"
              >
                <span
                  className={`h-7 w-7 rounded-full border-2 ${(selected && "color" in selected ? selected.color : color) === c ? "border-blue-600 ring-2 ring-blue-300" : "border-zinc-300"}`}
                  style={{ backgroundColor: c }}
                />
              </button>
            ))}
          </div>
        )}

        {showHighlightColors && (
          <div role="group" aria-label="Highlight colour" className="flex shrink-0 items-center">
            {HIGHLIGHT_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Highlight colour ${c}`}
                aria-pressed={(selected?.type === "highlight" ? selected.color : highlightColor) === c}
                onClick={() => applyHighlightColor(c)}
                className="flex h-11 w-11 items-center justify-center"
              >
                <span
                  className={`h-7 w-7 rounded-full border-2 ${(selected?.type === "highlight" ? selected.color : highlightColor) === c ? "border-blue-600 ring-2 ring-blue-300" : "border-zinc-300"}`}
                  style={{ backgroundColor: c }}
                />
              </button>
            ))}
          </div>
        )}

        {showPen &&
          PEN_WIDTHS.map((w) => (
            <button
              key={w.label}
              type="button"
              aria-pressed={(selected?.type === "ink" ? selected.width : penWidth) === w.value}
              onClick={() => applyPenWidth(w.value)}
              className={`${chip} ${(selected?.type === "ink" ? selected.width : penWidth) === w.value ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : "border-zinc-300 dark:border-zinc-700"}`}
            >
              {w.label}
            </button>
          ))}

        {selected?.type === "text" && !editingId && (
          <button
            type="button"
            onClick={() => {
              setTool("select");
              setEditingId(selected.id);
              setLive(annotations);
            }}
            className={`${chip} whitespace-nowrap border-zinc-300 dark:border-zinc-700`}
          >
            Edit text
          </button>
        )}

        {selected && (
          <button
            type="button"
            onClick={deleteSelected}
            className={`${chip} ml-auto gap-1 whitespace-nowrap border-red-200 text-red-600 dark:border-red-900 dark:text-red-400`}
          >
            Delete
          </button>
        )}

        {!showText && !showColor && !showHighlightColors && !showPen && !selected && (
          <p className="whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">{HINTS[tool] || HINTS.select}</p>
        )}
      </div>

      {/* The page scrolls inside this window when zoomed in. The controls float over
          it, so they are always in reach and never cost the page any room. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ZoomViewport api={zoom} className="min-h-0 flex-1 overflow-auto p-3">
          <ZoomFrame zoom={zoom.zoom} fit={`min(100%, calc((100dvh - 260px) * ${pageAspect}))`} minWidth="min(100%, 220px)">
          <AnnotationCanvas
            page={page}
            annotations={annotations}
            tool={tool}
            selectedId={selectedId}
            editingId={editingId}
            defaults={defaults}
            onSelect={setSelectedId}
            onStartEditing={(id) => {
              setEditingId(id);
              // Editing works on a live copy so it becomes one undo step.
              setLive((current) => current ?? annotations);
            }}
            onFinishEditing={finishEditing}
            onPreview={setLive}
            onCommit={commit}
            onDiscardPreview={() => setLive(null)}
            onPlaced={() => setTool("select")}
          />
          </ZoomFrame>
          {(tool !== "select" || annotations.length > 0) && (
            <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {tool === "select" && selected?.type === "signature"
                ? "Drag to move your signature. Drag the corner dot to resize it."
                : HINTS[tool]}
            </p>
          )}
          {zoom.zoom > 1 && (
            <p className="mt-1 text-center text-xs text-zinc-500 dark:text-zinc-400">Zoomed in: use two fingers, the scroll bars or the mouse wheel to move around.</p>
          )}
          {/* Room so the floating zoom controls never cover the bottom of the page. */}
          <div aria-hidden className="h-14" />
        </ZoomViewport>
        <ZoomControls api={zoom} className="absolute bottom-3 right-3 z-10 rounded-lg bg-surface/90 p-1 shadow-md" />
      </div>

      {signatureOpen && (
        <SignatureDialog lastSignature={lastSignature} initialTab={initialSignatureTab} onApply={(s, method) => void placeSignature(s, method)} onCancel={() => setSignatureOpen(false)} />
      )}
    </div>
  );
}

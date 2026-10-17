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
  createImage,
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
import {
  aspectRectWithin,
  effectiveDpi,
  getPreset,
  LOW_DPI,
  moveInStack,
  PHOTO_PRESETS,
  presetFractions,
  rotatedBox,
  rotateRect,
  SOFT_DPI,
  stackPosition,
  type Rect,
} from "@/utils/scanner/imagePlacement";
import { renderEdit } from "@/utils/scanner/imageInsert";
import type { ScannerPage } from "@/utils/scanner/page";
import type { SignatureImage } from "@/utils/scanner/signature";
import { AnnotationCanvas, type AnnotationDefaults } from "./AnnotationCanvas";
import { ImageDialog, type ImageChoice } from "./ImageDialog";
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
  { value: "image", label: "Add image", icon: "image" },
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
  image: "",
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
  const [tool, setTool] = useState<AnnotationTool>(initialTool && initialTool !== "signature" && initialTool !== "image" ? initialTool : "select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(initialTool === "signature");
  // The picture dialog: placing a new picture, or swapping the selected one.
  const [imageDialog, setImageDialog] = useState<"insert" | "replace" | null>(initialTool === "image" ? "insert" : null);
  const [imageNotice, setImageNotice] = useState<string | null>(null);

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
    if (next === "image") {
      setImageNotice(null);
      setImageDialog("insert");
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

  // ---- pictures ------------------------------------------------------------------

  async function placeImage(choice: ImageChoice) {
    const mode = imageDialog;
    setImageDialog(null);
    try {
      await loadAnnotationImage(choice.image.dataUrl);
    } catch {
      setImageNotice("That picture couldn't be shown. Try a different one.");
      return;
    }
    const preset = getPreset(choice.presetId);
    const size = preset ? presetFractions(preset, page.processedWidth, page.processedHeight) ?? undefined : undefined;
    const fresh = createImage(choice.image.dataUrl, choice.image.width, choice.image.height, page.processedWidth, page.processedHeight, size, { original: choice.original });
    const current = selected?.type === "image" ? selected : null;
    if (mode === "replace" && current) {
      // Same spot, same width (or the preset's size); the new picture's own shape.
      const cx = current.x + current.w / 2;
      const cy = current.y + current.h / 2;
      let w = size ? size.w : current.w;
      let h = size ? size.h : (w * page.processedWidth * (choice.image.height / choice.image.width)) / page.processedHeight;
      if (!size && h > 0.9) {
        h = 0.9;
        w = (h * page.processedHeight * (choice.image.width / choice.image.height)) / page.processedWidth;
      }
      const replaced = { ...fresh, id: current.id, w, h, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) };
      commit(annotations.map((a) => (a.id === current.id ? replaced : a)));
      setSelectedId(current.id);
    } else {
      commit([...annotations, fresh]);
      setSelectedId(fresh.id);
    }
    setTool("select");
    setImageNotice(null);
  }

  // The original behind a placed picture, and its current edits. A picture placed before this
  // existed has none, so its own pixels count as the original.
  function editStateOf(image: Extract<Annotation, { type: "image" }>) {
    const o = image.original;
    if (o) return o;
    return { dataUrl: image.dataUrl, width: image.pxW ?? 0, height: image.pxH ?? 0, mime: (image.dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg") as "image/png" | "image/jpeg", turns: 0 as const, crop: null };
  }

  // Draws the picture again from its ORIGINAL pixels with new edits, in one pass, so turning
  // or resizing repeatedly never compounds loss.
  async function rerender(image: Extract<Annotation, { type: "image" }>, turns: 0 | 1 | 2 | 3, crop: Rect | null) {
    const o = editStateOf(image);
    const out = await renderEdit(o, turns, crop);
    await loadAnnotationImage(out.dataUrl);
    return { out, original: { ...o, turns, crop } };
  }

  // Turns the selected picture a quarter turn.
  async function rotateSelectedImage(direction: 1 | -1) {
    if (selected?.type !== "image") return;
    const current = selected;
    try {
      const o = editStateOf(current);
      const turns = ((o.turns + direction + 4) % 4) as 0 | 1 | 2 | 3;
      const crop = o.crop ? rotateRect(o.crop, direction) : null;
      const { out, original } = await rerender(current, turns, crop);
      const box = rotatedBox(current, page.processedWidth, page.processedHeight);
      commit(annotations.map((a) => (a.id === current.id ? { ...current, ...box, dataUrl: out.dataUrl, pxW: out.width, pxH: out.height, original } : a)));
    } catch {
      setImageNotice("That picture couldn't be turned. Try again.");
    }
  }

  // Gives the selected picture a stated real-world size, trimming (never stretching) the
  // original to that shape inside what was already chosen.
  async function sizeSelectedImage(presetId: string) {
    if (selected?.type !== "image") return;
    const current = selected;
    const preset = getPreset(presetId);
    if (!preset) return;
    const size = presetFractions(preset, page.processedWidth, page.processedHeight);
    if (!size) {
      setImageNotice("That size doesn't fit on this page.");
      return;
    }
    try {
      const o = editStateOf(current);
      const turned = o.turns % 2 === 1;
      const sw = turned ? o.height : o.width;
      const sh = turned ? o.width : o.height;
      const crop = aspectRectWithin(o.crop ?? { x: 0, y: 0, w: 1, h: 1 }, sw, sh, preset.widthMm / preset.heightMm);
      const { out, original } = await rerender(current, o.turns, crop);
      const cx = current.x + current.w / 2;
      const cy = current.y + current.h / 2;
      commit(
        annotations.map((a) =>
          a.id === current.id
            ? { ...current, dataUrl: out.dataUrl, pxW: out.width, pxH: out.height, original, w: size.w, h: size.h, x: clamp(cx - size.w / 2, 0, 1 - size.w), y: clamp(cy - size.h / 2, 0, 1 - size.h) }
            : a,
        ),
      );
      setImageNotice(null);
    } catch {
      setImageNotice("That picture couldn't be resized. Try again.");
    }
  }

  // How sharp the selected picture will be when printed at the size it is placed at.
  const imageDpi = selected?.type === "image" ? effectiveDpi(selected.pxW, selected.w, page.processedWidth, page.processedHeight) : null;

  function moveSelectedInStack(move: "forward" | "backward" | "front" | "back") {
    if (!selectedId) return;
    const next = moveInStack(annotations, selectedId, move);
    if (next !== annotations) commit(next);
  }

  // ---- keyboard -----------------------------------------------------------------

  useEffect(() => {
    firstToolRef.current?.focus();
  }, []);

  useEffect(() => {
    // Capture phase, so Escape and undo here don't also reach the page editor
    // underneath (which closes on Escape).
    function onKeyDown(e: KeyboardEvent) {
      if (signatureOpen || imageDialog) return;
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
            data-assistant-id={`annotation-tool-${t.value}`}
            type="button"
            aria-pressed={tool === t.value && t.value !== "signature" && t.value !== "image"}
            onClick={() => chooseTool(t.value)}
            className={`${chip} gap-1.5 whitespace-nowrap ${
              tool === t.value && t.value !== "signature" && t.value !== "image"
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

        {selected?.type === "image" && (
          <>
            <button type="button" data-assistant-id="image-replace" onClick={() => { setImageNotice(null); setImageDialog("replace"); }} className={`${chip} whitespace-nowrap border-zinc-300 dark:border-zinc-700`}>
              Replace
            </button>
            <button type="button" aria-label="Rotate picture left" onClick={() => void rotateSelectedImage(-1)} className={`${chip} border-zinc-300 dark:border-zinc-700`}>
              ↺
            </button>
            <button type="button" aria-label="Rotate picture right" onClick={() => void rotateSelectedImage(1)} className={`${chip} border-zinc-300 dark:border-zinc-700`}>
              ↻
            </button>
            <button
              type="button"
              aria-label="Bring forward"
              title="Move above other items"
              disabled={!stackPosition(annotations, selected.id).canForward}
              onClick={() => moveSelectedInStack("forward")}
              className={`${chip} whitespace-nowrap border-zinc-300 disabled:opacity-40 dark:border-zinc-700`}
            >
              Forward
            </button>
            <button
              type="button"
              aria-label="Send backward"
              title="Move below other items"
              disabled={!stackPosition(annotations, selected.id).canBackward}
              onClick={() => moveSelectedInStack("backward")}
              className={`${chip} whitespace-nowrap border-zinc-300 disabled:opacity-40 dark:border-zinc-700`}
            >
              Backward
            </button>
            <select
              aria-label="Photo size"
              value=""
              onChange={(e) => void sizeSelectedImage(e.target.value)}
              className="h-11 shrink-0 rounded-lg border border-zinc-300 bg-surface px-2 text-sm dark:border-zinc-700"
            >
              <option value="">Photo size…</option>
              {PHOTO_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        )}

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

        {imageDpi !== null && imageDpi < SOFT_DPI && (
          <p role="status" className="whitespace-nowrap text-sm text-amber-700 dark:text-amber-400">
            {imageDpi < LOW_DPI ? "Low resolution" : "Soft when printed"}: about {imageDpi} dpi at this size. A larger original picture or a smaller size looks sharper.
          </p>
        )}

        {imageNotice && (
          <p role="alert" className="whitespace-nowrap text-sm text-red-700 dark:text-red-400">
            {imageNotice}
          </p>
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
                : tool === "select" && selected?.type === "image"
                  ? "Drag to move your picture. Drag the corner dot to resize it without stretching it."
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

      {imageDialog && (
        <ImageDialog
          mode={imageDialog}
          pageWidthPx={page.processedWidth}
          pageHeightPx={page.processedHeight}
          onApply={(choice) => void placeImage(choice)}
          onCancel={() => setImageDialog(null)}
        />
      )}

      {signatureOpen && (
        <SignatureDialog lastSignature={lastSignature} initialTab={initialSignatureTab} onApply={(s, method) => void placeSignature(s, method)} onCancel={() => setSignatureOpen(false)} />
      )}
    </div>
  );
}

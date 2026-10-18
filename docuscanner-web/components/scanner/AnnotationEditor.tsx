"use client";

// Full-screen editor for adding text, pen drawings, highlights, check marks,
// crosses, dates and signatures on top of a page. Opened from the page editor,
// like the crop editor. Works on a private copy of the page's annotations with
// its own undo/redo history and hands the result back on Done, so nothing
// changes on the page until then.

import { Icon, type IconName } from "@/components/ui/icons";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { OPEN_ASSISTANT_EVENT } from "@/components/assistant/AssistantLauncher";
import { useGuidance } from "@/components/guidance/useGuidance";
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
  REFERENCE_PAGE_WIDTH_PT,
  sizeToPt,
  translateAnnotation,
  type Annotation,
  type AnnotationTool,
} from "@/utils/scanner/annotations";
import { annotationBounds, loadAnnotationImage } from "@/utils/scanner/annotationRender";
import {
  effectiveDpi,
  getPreset,
  LOW_DPI,
  moveInStack,
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
import { ImageEditDialog, type ImageEditResult } from "./ImageEditDialog";
import { NudgePad, type NudgeStep } from "./NudgePad";
import { SignatureDialog, type Tab as SignatureTab } from "./SignatureDialog";
import { useFitBox } from "./useFitBox";
import { useZoom, ZoomControls, ZoomFrame, ZoomViewport } from "./zoom";

// `primary` tools are always on screen; the others sit behind "More" on a phone so the toolbar stays small.
const TOOLS: { value: AnnotationTool; label: string; short: string; icon: IconName; primary: boolean }[] = [
  { value: "select", label: "Select", short: "Select", icon: "pointer", primary: true },
  { value: "pan", label: "Move page", short: "Move", icon: "hand", primary: true },
  { value: "text", label: "Text", short: "Text", icon: "text", primary: true },
  { value: "signature", label: "Signature", short: "Sign", icon: "signature", primary: true },
  { value: "image", label: "Add image", short: "Image", icon: "image", primary: true },
  { value: "draw", label: "Draw", short: "Draw", icon: "pen", primary: false },
  { value: "highlight", label: "Highlight", short: "Highlight", icon: "highlight", primary: false },
  { value: "check", label: "Check", short: "Check", icon: "check", primary: false },
  { value: "cross", label: "X", short: "X", icon: "x", primary: false },
  { value: "date", label: "Date", short: "Date", icon: "calendar", primary: false },
];

// How far one arrow press moves a mark, in points on the page (the page is 595 pt wide at A4, and
// the step scales with the page, not with the zoom).
const NUDGE_FINE_PT = 3;
const NUDGE_COARSE_PT = 15;
// Presses this close together are one undo step.
const NUDGE_JOIN_MS = 900;

const PHONE_QUERY = "(max-width: 639px)";
function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia(PHONE_QUERY);
      q.addEventListener("change", cb);
      return () => q.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

const HINTS: Record<AnnotationTool, string> = {
  pan: "Drag the page to move around it. Pinch or use + and - to zoom. Choose Select to edit again.",
  select: "Tap a mark to move it. Drag its corner dot to resize. Drag empty page to move around.",
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
  const [imageEditOpen, setImageEditOpen] = useState(false);
  // Phone toolbar: the less-used tools, and the whole tool area, can be folded away to give the page room.
  const [moreTools, setMoreTools] = useState(false);
  const [toolsHidden, setToolsHidden] = useState(false);
  const [nudgeStep, setNudgeStep] = useState<NudgeStep>("fine");
  const [moveStatus, setMoveStatus] = useState("");
  const [nextHintClosed, setNextHintClosed] = useState(false);
  const lastNudge = useRef<{ id: string } | null>(null);
  const nudgeTimer = useRef<number | null>(null);
  const phone = usePhone();
  const guidance = useGuidance();

  const [color, setColor] = useState<string>(PALETTE[0]);
  const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_PALETTE[0]);
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS[1].value);
  const [textPt, setTextPt] = useState(DEFAULT_TEXT_PT);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);

  const firstToolRef = useRef<HTMLButtonElement>(null);
  const zoom = useZoom();
  const pageAspect = page.processedWidth / page.processedHeight;
  // The page is as large as the room allows: measured, not a guess about how tall the toolbars are.
  const { ref: stageRef, box: stageBox } = useFitBox(pageAspect, phone ? 8 : 12);
  const annotations = live ?? history.present;
  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  const defaults: AnnotationDefaults = { color, highlightColor, penWidth, text: { pt: textPt, color, bold, italic } };

  // ---- history ----------------------------------------------------------------

  function commit(next: Annotation[]) {
    const added = next.filter((n) => !history.present.some((p) => p.id === n.id));
    added.forEach((a) => onTrack(`annotation_${a.type}`));
    lastNudge.current = null;
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
    lastNudge.current = null;
    finishEditing();
    setHistory((h) =>
      h.past.length === 0
        ? h
        : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] },
    );
    // Keep the mark selected if it is still there, so a move can be undone and nudged again.
    const target = history.past[history.past.length - 1];
    if (!target || !target.some((a) => a.id === selectedId)) setSelectedId(null);
  }

  function redo() {
    lastNudge.current = null;
    finishEditing();
    setHistory((h) =>
      h.future.length === 0
        ? h
        : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) },
    );
    const target = history.future[0];
    if (!target || !target.some((a) => a.id === selectedId)) setSelectedId(null);
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
    if (next === "pan") guidance.dismiss("editor-pan-tip");
    if (next !== "select") setSelectedId(null);
  }

  // ---- precise placement ---------------------------------------------------------------------

  // Moves the selected mark by one step. Steps are a fixed distance on the page, so they mean the same at
  // every zoom, and the mark can never leave the page.
  function nudge(dirX: -1 | 0 | 1, dirY: -1 | 0 | 1, coarse: boolean) {
    if (!selected || editingId || live) return;
    const stepX = (coarse ? NUDGE_COARSE_PT : NUDGE_FINE_PT) / REFERENCE_PAGE_WIDTH_PT;
    const stepY = (stepX * page.processedWidth) / page.processedHeight;
    const b = annotationBounds(selected, page.processedWidth, page.processedHeight);
    const dx = clamp(dirX * stepX, -b.x, Math.max(-b.x, 1 - (b.x + b.w)));
    const dy = clamp(dirY * stepY, -b.y, Math.max(-b.y, 1 - (b.y + b.h)));
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
      setMoveStatus("Already at the edge of the page");
      return;
    }
    const moved = translateAnnotation(selected, dx, dy);
    const next = annotations.map((a) => (a.id === selected.id ? moved : a));
    const last = lastNudge.current;
    if (last && last.id === selected.id && history.past.length > 0) {
      // A run of presses is one undo step.
      setHistory((h) => ({ ...h, present: next, future: [] }));
    } else {
      commit(next);
    }
    lastNudge.current = { id: selected.id };
    // A run of presses is one undo step; a pause ends the run.
    if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => (lastNudge.current = null), NUDGE_JOIN_MS);
    setMoveStatus(`Moved ${dirX < 0 ? "left" : dirX > 0 ? "right" : dirY < 0 ? "up" : "down"}`);
  }

  // Scrolls the zoomed page when a finger drags empty page.
  function panBy(dx: number, dy: number) {
    const el = zoom.getViewport();
    if (!el) return;
    el.scrollLeft -= dx;
    el.scrollTop -= dy;
  }

  // Makes the selected picture or signature a little bigger or smaller, keeping its shape and centre.
  function scaleSelected(factor: number) {
    if (selected?.type !== "image" && selected?.type !== "signature") return;
    const current = selected;
    const shape = (current.h * page.processedHeight) / (current.w * page.processedWidth);
    const cx = current.x + current.w / 2;
    const cy = current.y + current.h / 2;
    let w = clamp(current.w * factor, 0.04, 1);
    let h = (w * page.processedWidth * shape) / page.processedHeight;
    if (h > 1) {
      h = 1;
      w = (h * page.processedHeight) / (shape * page.processedWidth);
    }
    commit(annotations.map((a) => (a.id === current.id ? { ...current, w, h, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) } : a)));
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
    const size = preset ? presetFractions(preset, page.processedWidth, page.processedHeight, page.ptPerPx) ?? undefined : undefined;
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
      // placedScale follows the size it is really placed at, so Reset size / Restore original return to it.
      const replaced = { ...fresh, id: current.id, w, h, placedScale: w / choice.image.width, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) };
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

  // Where a picture sits and how big it is after an edit. It never reduces the picture's pixels:
  //  keep   -> every pixel keeps the page size it had, so cropping shows the same part at the same scale
  //  reset  -> the scale the picture had when it was first placed
  //  preset -> a stated real-world size (35 x 45 mm ...), a size on paper, independent of the pixel count
  function boxAfterEdit(current: Extract<Annotation, { type: "image" }>, outW: number, outH: number, size: ImageEditResult["size"]) {
    const pageW = page.processedWidth;
    const pageH = page.processedHeight;
    let w: number;
    let h: number;
    if (size.kind === "preset") {
      const preset = getPreset(size.id);
      const fractions = preset ? presetFractions(preset, pageW, pageH, page.ptPerPx) : null;
      if (!fractions) return null;
      ({ w, h } = fractions);
    } else {
      const nowScale = current.pxW ? current.w / current.pxW : null;
      const scale = size.kind === "reset" ? (current.placedScale ?? nowScale) : nowScale;
      w = scale ? outW * scale : current.w;
      h = (w * pageW * (outH / outW)) / pageH;
      const shrink = Math.min(1, 1 / w, 1 / h);
      w *= shrink;
      h *= shrink;
    }
    const cx = current.x + current.w / 2;
    const cy = current.y + current.h / 2;
    return { w, h, x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h) };
  }

  // Applies what the picture dialog chose (or Restore original). ONE undo step; the pixels are drawn again
  // from the untouched original in a single pass.
  async function applyImageEdit(result: ImageEditResult) {
    if (selected?.type !== "image") return;
    const current = selected;
    setImageEditOpen(false);
    try {
      const { out, original } = await rerender(current, result.turns, result.crop);
      const box = boxAfterEdit(current, out.width, out.height, result.size);
      if (!box) {
        setImageNotice("That size doesn't fit on this page.");
        return;
      }
      commit(annotations.map((a) => (a.id === current.id ? { ...current, ...box, dataUrl: out.dataUrl, pxW: out.width, pxH: out.height, original } : a)));
      setImageNotice(null);
    } catch {
      setImageNotice("That picture couldn't be edited. Try again.");
    }
  }

  // Back to the picture as it was first placed: original pixels, no crop, no turn, first on-page size.
  function restoreOriginalImage() {
    void applyImageEdit({ turns: 0, crop: null, size: { kind: "reset" } });
  }

  // Has the selected picture been cropped, turned or resized since it was placed?
  function imageEdited(image: Extract<Annotation, { type: "image" }>): boolean {
    const o = image.original;
    if (!o) return false;
    if (o.turns !== 0 || o.crop) return true;
    return image.placedScale ? Math.abs(image.w - o.width * image.placedScale) / image.w > 0.01 : false;
  }

  // How sharp the selected picture will be when printed at the size it is placed at.
  const imageDpi = selected?.type === "image" ? effectiveDpi(selected.pxW, selected.w, page.processedWidth, page.processedHeight, page.ptPerPx) : null;

  function moveSelectedInStack(move: "forward" | "backward" | "front" | "back") {
    if (!selectedId) return;
    const next = moveInStack(annotations, selectedId, move);
    if (next !== annotations) commit(next);
  }

  // Done editing: hand the work back. If the next-step hint was on screen, it has done its job.
  function finishAndClose() {
    if (history.past.length > 0 || live) guidance.dismiss("editor-next-step");
    onDone(resolveFinal());
  }

  // ---- hints ----------------------------------------------------------------------------------

  const showPanTip = phone && guidance.showTip("editor-pan-tip");
  const showNextHint = !showPanTip && !nextHintClosed && history.past.length > 0 && guidance.showTip("editor-next-step");
  useEffect(() => {
    if (!showNextHint) return;
    const timer = window.setTimeout(() => setNextHintClosed(true), 12000);
    return () => window.clearTimeout(timer);
  }, [showNextHint]);

  // ---- keyboard -----------------------------------------------------------------

  useEffect(() => {
    firstToolRef.current?.focus();
  }, []);

  useEffect(() => {
    // Capture phase, so Escape and undo here don't also reach the page editor
    // underneath (which closes on Escape).
    function onKeyDown(e: KeyboardEvent) {
      if (signatureOpen || imageDialog || imageEditOpen) return;
      const inField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable);

      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        // One step back at a time: stop typing, then let go of the mark, then leave a tool, then close.
        if (editingId) finishEditing();
        else if (selectedId) setSelectedId(null);
        else if (tool !== "select") setTool("select");
        else finishAndClose();
        return;
      }
      if (inField || editingId) return;

      // Arrow keys place the selected mark (Shift = a bigger step). Never while typing in a field.
      const arrow = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [-1 | 0 | 1, -1 | 0 | 1]>)[e.key];
      if (arrow && selected && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        nudge(arrow[0], arrow[1], e.shiftKey);
        return;
      }

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

  const chip = "flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border px-2 text-sm font-medium";
  const border = "border-zinc-300 dark:border-zinc-700";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Annotate page ${index + 1}`}
      className="fixed inset-0 z-[60] flex flex-col bg-zinc-100 dark:bg-zinc-950"
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-surface px-2 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] dark:border-zinc-800 sm:gap-2 sm:px-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
          <span className="sm:hidden">Page {index + 1}</span>
          <span className="hidden sm:inline">Annotate page {index + 1}</span>
        </h2>
        <button
          type="button"
          onClick={() => setToolsHidden((v) => !v)}
          aria-expanded={!toolsHidden}
          aria-label={toolsHidden ? "Show the tools" : "Hide the tools to give the page more room"}
          title={toolsHidden ? "Show the tools" : "Hide the tools"}
          data-assistant-id="annotation-toggle-tools"
          className={`${chip} ${border}`}
        >
          <Icon name="chevron-down" size={18} className={`transition-transform ${toolsHidden ? "" : "rotate-180"}`} />
        </button>
        <button type="button" onClick={undo} disabled={history.past.length === 0 && !live} aria-label="Undo" className={`${chip} ${border} disabled:opacity-40`}>
          <Icon name="undo" size={18} />
        </button>
        <button type="button" onClick={redo} disabled={history.future.length === 0} aria-label="Redo" className={`${chip} ${border} disabled:opacity-40`}>
          <Icon name="redo" size={18} />
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))}
          aria-label="Ask for help"
          title="Ask for help"
          data-assistant-id="annotation-help"
          className={`${chip} ${border}`}
        >
          <Icon name="info" size={18} />
        </button>
        <button
          type="button"
          onClick={finishAndClose}
          data-assistant-id="annotation-done"
          title="Keep your changes and go back to the page"
          className="btn btn-primary whitespace-nowrap"
        >
          Done editing
        </button>
      </div>

      {!toolsHidden && (
        <div
          role="toolbar"
          aria-label="Annotation tools"
          className="grid shrink-0 grid-cols-6 gap-1 border-b border-zinc-200 bg-surface px-2 py-1.5 dark:border-zinc-800 sm:grid-cols-10 sm:px-3 lg:flex lg:flex-wrap"
        >
          {TOOLS.map((t, i) => {
            const active = tool === t.value && t.value !== "signature" && t.value !== "image";
            return (
              <button
                key={t.value}
                ref={i === 0 ? firstToolRef : undefined}
                data-assistant-id={`annotation-tool-${t.value}`}
                type="button"
                aria-pressed={active}
                aria-label={t.label}
                title={t.value === "pan" ? "Move page: drag the page to move around it" : t.label}
                onClick={() => chooseTool(t.value)}
                className={`${chip} h-14 flex-col gap-0.5 whitespace-nowrap px-1 text-[11px] leading-tight lg:h-11 lg:flex-row lg:gap-1.5 lg:px-2 lg:text-sm ${
                  t.primary || moreTools ? "" : "hidden sm:flex"
                } ${active ? "border-blue-600 bg-blue-600 text-white" : border}`}
              >
                <Icon name={t.icon} size={18} />
                <span className="lg:hidden">{t.short}</span>
                <span className="hidden lg:inline">{t.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            aria-expanded={moreTools}
            data-assistant-id="annotation-more-tools"
            onClick={() => setMoreTools((v) => !v)}
            className={`${chip} ${border} h-14 flex-col gap-0.5 px-1 text-[11px] leading-tight sm:hidden`}
          >
            <Icon name="chevron-down" size={18} className={moreTools ? "rotate-180" : ""} />
            {moreTools ? "Less" : "More"}
          </button>
        </div>
      )}

      {!toolsHidden && (
        <div
          aria-label="Tool options"
          className="flex min-h-[52px] shrink-0 items-center gap-2 overflow-x-auto border-b border-zinc-200 bg-surface px-2 py-1 dark:border-zinc-800 sm:min-h-[60px] sm:px-3"
        >
          {showText && (
            <>
              <button type="button" aria-label="Smaller text" onClick={() => applyPt(shownPt - 2)} className={`${chip} ${border}`}>
                A−
              </button>
              <span className="w-12 shrink-0 text-center text-sm tabular-nums" aria-label="Font size">
                {shownPt} pt
              </span>
              <button type="button" aria-label="Larger text" onClick={() => applyPt(shownPt + 2)} className={`${chip} ${border}`}>
                A+
              </button>
              <button
                type="button"
                aria-label="Bold"
                aria-pressed={shownBold}
                onClick={() => applyBold(!shownBold)}
                className={`${chip} font-bold ${shownBold ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : border}`}
              >
                B
              </button>
              <button
                type="button"
                aria-label="Italic"
                aria-pressed={shownItalic}
                onClick={() => applyItalic(!shownItalic)}
                className={`${chip} italic ${shownItalic ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : border}`}
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
                className={`${chip} ${(selected?.type === "ink" ? selected.width : penWidth) === w.value ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : border}`}
              >
                {w.label}
              </button>
            ))}

          {selected?.type === "signature" && (
            <>
              <button type="button" aria-label="Make the signature smaller" onClick={() => scaleSelected(1 / 1.1)} className={`${chip} whitespace-nowrap ${border}`}>
                Smaller
              </button>
              <button type="button" aria-label="Make the signature larger" onClick={() => scaleSelected(1.1)} className={`${chip} whitespace-nowrap ${border}`}>
                Larger
              </button>
            </>
          )}

          {selected?.type === "image" && (
            <>
              <button
                type="button"
                data-assistant-id="image-edit"
                onClick={() => {
                  setImageNotice(null);
                  setImageEditOpen(true);
                }}
                className={`${chip} gap-1.5 whitespace-nowrap border-blue-600 bg-blue-600 text-white`}
              >
                <Icon name="crop" size={18} />
                Edit image
              </button>
              <button type="button" aria-label="Rotate picture left" onClick={() => void rotateSelectedImage(-1)} className={`${chip} ${border}`}>
                ↺
              </button>
              <button type="button" aria-label="Rotate picture right" onClick={() => void rotateSelectedImage(1)} className={`${chip} ${border}`}>
                ↻
              </button>
              <button type="button" aria-label="Make the picture smaller" onClick={() => scaleSelected(1 / 1.1)} className={`${chip} whitespace-nowrap ${border}`}>
                Smaller
              </button>
              <button type="button" aria-label="Make the picture larger" onClick={() => scaleSelected(1.1)} className={`${chip} whitespace-nowrap ${border}`}>
                Larger
              </button>
              <button
                type="button"
                data-assistant-id="image-replace"
                onClick={() => {
                  setImageNotice(null);
                  setImageDialog("replace");
                }}
                className={`${chip} whitespace-nowrap ${border}`}
              >
                Replace image
              </button>
              {imageEdited(selected) && (
                <button type="button" data-assistant-id="image-restore" onClick={restoreOriginalImage} className={`${chip} whitespace-nowrap ${border}`}>
                  Restore original
                </button>
              )}
              <button
                type="button"
                aria-label="Bring forward"
                title="Move above other items"
                disabled={!stackPosition(annotations, selected.id).canForward}
                onClick={() => moveSelectedInStack("forward")}
                className={`${chip} whitespace-nowrap ${border} disabled:opacity-40`}
              >
                Forward
              </button>
              <button
                type="button"
                aria-label="Send backward"
                title="Move below other items"
                disabled={!stackPosition(annotations, selected.id).canBackward}
                onClick={() => moveSelectedInStack("backward")}
                className={`${chip} whitespace-nowrap ${border} disabled:opacity-40`}
              >
                Backward
              </button>
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
              className={`${chip} whitespace-nowrap ${border}`}
            >
              Edit text
            </button>
          )}

          {selected && (
            <button
              type="button"
              onClick={deleteSelected}
              className={`${chip} ml-auto hidden gap-1 whitespace-nowrap border-red-200 text-red-600 dark:border-red-900 dark:text-red-400 sm:flex`}
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
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{HINTS[tool] || HINTS.select}</p>
          )}
        </div>
      )}

      {/* The stage takes every pixel the toolbars leave. The page is fitted to it by measurement, and
          scrolls inside it when zoomed in. Nothing floats over the page. */}
      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <div ref={stageRef} className="relative min-h-0 min-w-0 flex-1" data-editor-stage>
          <ZoomViewport api={zoom} pan={tool === "pan"} className="absolute inset-0 overflow-auto p-2 sm:p-3">
            <ZoomFrame
              zoom={zoom.zoom}
              fit={stageBox ? `${stageBox.w}px` : `min(100%, calc((100dvh - 260px) * ${pageAspect}))`}
              minWidth="min(100%, 220px)"
            >
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
                onPan={panBy}
                onDelete={phone ? deleteSelected : undefined}
              />
            </ZoomFrame>
          </ZoomViewport>

          {(showPanTip || showNextHint) && (
            <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex justify-center">
              <div
                role="note"
                data-editor-hint={showPanTip ? "pan" : "next"}
                className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border border-blue-200 bg-blue-50/95 px-3 py-2 text-sm text-blue-950 shadow-md dark:border-blue-900 dark:bg-blue-950/95 dark:text-blue-100"
              >
                <Icon name="info" size={18} className="mt-0.5 shrink-0" />
                <p className="min-w-0 flex-1">
                  {showPanTip ? (
                    "Move around the page using one finger, or pinch to zoom. Select Move Page if you want to drag the canvas."
                  ) : (
                    <>
                      <strong className="block">Your changes are ready.</strong>
                      Continue editing or choose Done editing when you&apos;re ready to export.
                    </>
                  )}
                </p>
                <button
                  type="button"
                  aria-label="Dismiss this tip"
                  onClick={() => (showPanTip ? guidance.dismiss("editor-pan-tip") : (guidance.dismiss("editor-next-step"), setNextHintClosed(true)))}
                  className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div
          role="toolbar"
          aria-label="Zoom and position"
          data-editor-rail
          className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-zinc-200 bg-surface px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-1.5 dark:border-zinc-800 sm:px-3 lg:w-[18.5rem] lg:flex-col lg:items-stretch lg:justify-start lg:gap-4 lg:border-l lg:border-t-0 lg:p-3"
        >
          <ZoomControls api={zoom} fit />
          <NudgePad
            enabled={!!selected && !editingId}
            step={nudgeStep}
            fineLabel={`${NUDGE_FINE_PT} pt`}
            coarseLabel={`${NUDGE_COARSE_PT} pt`}
            onStep={setNudgeStep}
            onMove={(dx, dy) => nudge(dx, dy, nudgeStep === "coarse")}
          />
        </div>
        <p role="status" className="sr-only">
          {moveStatus}
        </p>
      </div>

      {imageDialog && (
        <ImageDialog
          mode={imageDialog}
          pageWidthPx={page.processedWidth}
          pageHeightPx={page.processedHeight}
          ptPerPx={page.ptPerPx}
          onApply={(choice) => void placeImage(choice)}
          onCancel={() => setImageDialog(null)}
        />
      )}

      {imageEditOpen && selected?.type === "image" && (
        <ImageEditDialog
          key={selected.id}
          original={editStateOf(selected)}
          startTurns={editStateOf(selected).turns}
          startCrop={editStateOf(selected).crop}
          onApply={(result) => void applyImageEdit(result)}
          onCancel={() => setImageEditOpen(false)}
        />
      )}

      {signatureOpen && (
        <SignatureDialog lastSignature={lastSignature} initialTab={initialSignatureTab} onApply={(s, method) => void placeSignature(s, method)} onCancel={() => setSignatureOpen(false)} />
      )}
    </div>
  );
}

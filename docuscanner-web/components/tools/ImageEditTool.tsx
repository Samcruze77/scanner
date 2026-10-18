"use client";

// Edit Image: open one picture, crop / rotate / flip / resize / adjust it, and download a PICTURE file
// (never a PDF). Everything happens in the browser; nothing is uploaded.
//
// Quality model: the original is decoded once at its full size and never altered. Every edit is a small
// instruction (utils/imageEdit/ops.ts) and the download is drawn from the original pixels in a single pass
// (utils/imageEdit/render.ts). The preview is drawn from a smaller copy, so moving a slider is quick, but
// the file you download never comes from the preview.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDropzone } from "@/components/convert/FileDropzone";
import { CropOverlay } from "@/components/tools/CropOverlay";
import { ErrorBanner } from "@/components/scanner/ErrorBanner";
import { Icon } from "@/components/ui/icons";
import { trackDocumentDownloaded, trackDocumentUploaded } from "@/utils/analytics/events";
import { downloadBlob } from "@/utils/convert/download";
import { ASPECT_PRESETS, fitAspect, MIN_CROP, normalizeRect, presetById } from "@/utils/imageEdit/crop";
import {
  availableFormats,
  exportFileName,
  FILE_ACCEPT,
  formatBytes,
  INPUT_FORMAT_LABEL,
  isHexColour,
  megapixels,
  OUTPUT_INFO,
  planExport,
  type EncoderSupport,
  type OutputFormat,
} from "@/utils/imageEdit/formats";
import {
  flipHorizontal,
  flipVertical,
  geometry,
  IDENTITY_STATE,
  isIdentity,
  isUpscaled,
  outputProblem,
  rotateBy,
  sourceRectToView,
  statesEqual,
  viewRectToSource,
  viewSize,
  withAdjustments,
  withCrop,
  withResize,
  type EditState,
  type Rect,
} from "@/utils/imageEdit/ops";
import { disposeImage, domCanvas, ERROR_MESSAGES, exportImage, ImageEditError, loadImage, probeEncoders, type LoadedImage } from "@/utils/imageEdit/browser";
import { renderEdited } from "@/utils/imageEdit/render";

const PREVIEW_SIDE = 1600;
const DEFAULT_QUALITY = 95;
// Lets the browser paint "working" text before a long, blocking draw starts.
const paint = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

interface History {
  states: EditState[];
  index: number;
}
const FRESH: History = { states: [IDENTITY_STATE], index: 0 };

function startingFormat(source: LoadedImage["format"], support: EncoderSupport | null): OutputFormat {
  const wanted: OutputFormat = source === "jpeg" ? "jpeg" : source === "webp" ? "webp" : "png";
  if (!support) return wanted;
  return support[wanted] ? wanted : support.png ? "png" : support.jpeg ? "jpeg" : "webp";
}

export function ImageEditTool() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [pending, setPending] = useState<LoadedImage | null>(null);
  const [history, setHistory] = useState<History>(FRESH);
  const [draft, setDraft] = useState<{ brightness: number; contrast: number } | null>(null);
  const [mode, setMode] = useState<"edit" | "crop">("edit");
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [aspectId, setAspectId] = useState("free");
  const [lockAspect, setLockAspect] = useState(true);
  const [sizeDraft, setSizeDraft] = useState<{ field: "w" | "h"; text: string } | null>(null);
  const [support, setSupport] = useState<EncoderSupport | null>(null);
  const [format, setFormat] = useState<OutputFormat>("png");
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [background, setBackground] = useState("#ffffff");
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [dragging, setDragging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<LoadedImage | null>(null);
  const pendingRef = useRef<LoadedImage | null>(null);
  const loadToken = useRef(0);
  const replaceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    imageRef.current = image;
  }, [image]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  // Free the decoded picture when the page is left.
  useEffect(
    () => () => {
      disposeImage(imageRef.current);
      disposeImage(pendingRef.current);
    },
    [],
  );
  useEffect(() => {
    let alive = true;
    void probeEncoders().then((s) => alive && setSupport(s));
    return () => {
      alive = false;
    };
  }, []);

  const committed = history.states[history.index];
  const state: EditState = useMemo(() => (draft ? withAdjustments(committed, draft.brightness, draft.contrast) : committed), [committed, draft]);
  const srcW = image?.width ?? 0;
  const srcH = image?.height ?? 0;
  const geo = image ? geometry(srcW, srcH, state) : null;
  const unchanged = image ? isIdentity(state, srcW, srcH) : true;
  const formats = useMemo(() => (support ? availableFormats(support) : []), [support]);

  // ---- history -------------------------------------------------------------------------------------------

  const commit = useCallback((next: EditState) => {
    setHistory((h) => {
      if (statesEqual(h.states[h.index], next)) return h;
      const states = [...h.states.slice(0, h.index + 1), next].slice(-100);
      return { states, index: states.length - 1 };
    });
    setDraft(null);
  }, []);

  // A slider change that no pointer or key release has committed (a screen reader, say) is committed once it settles.
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => commit(withAdjustments(committed, draft.brightness, draft.contrast)), 600);
    return () => clearTimeout(timer);
  }, [draft, committed, commit]);

  function undo() {
    setDraft(null);
    setHistory((h) => (h.index > 0 ? { ...h, index: h.index - 1 } : h));
    setStatus("Undid the last change.");
  }
  function redo() {
    setDraft(null);
    setHistory((h) => (h.index < h.states.length - 1 ? { ...h, index: h.index + 1 } : h));
    setStatus("Redid the change.");
  }
  function resetEdits() {
    commit(IDENTITY_STATE);
    setStatus("All edits reset. You can undo this.");
  }
  function restoreOriginal() {
    setHistory(FRESH);
    setDraft(null);
    setMode("edit");
    setSizeDraft(null);
    setStatus("Original restored.");
  }

  // ---- opening a picture -----------------------------------------------------------------------------

  function adopt(next: LoadedImage) {
    const old = imageRef.current;
    setImage(next);
    setPending(null);
    setHistory(FRESH);
    setDraft(null);
    setMode("edit");
    setSizeDraft(null);
    setAspectId("free");
    setFormat(startingFormat(next.format, support));
    setQuality(DEFAULT_QUALITY);
    setKeepOriginal(true);
    setBackground("#ffffff");
    setStatus(`Opened ${next.file.name}: ${next.width} × ${next.height} pixels.`);
    if (old) setTimeout(() => disposeImage(old), 0);
  }

  async function choose(file: File) {
    const token = ++loadToken.current;
    setError(null);
    setBusy("Opening your picture…");
    await paint();
    try {
      const next = await loadImage(file);
      if (token !== loadToken.current) {
        disposeImage(next);
        return;
      }
      void trackDocumentUploaded(file.type || "image", file.size);
      const hasEdits = imageRef.current && history.index > 0;
      if (imageRef.current && hasEdits) {
        disposeImage(pendingRef.current);
        setPending(next);
        setStatus("Replace the current picture? Your edits to it will be lost.");
      } else {
        adopt(next);
      }
    } catch (err) {
      if (token !== loadToken.current) return;
      // The current picture and its edits are left exactly as they were.
      setError(err instanceof ImageEditError ? ERROR_MESSAGES[err.code] : ERROR_MESSAGES.decode_failed);
      setStatus("");
    } finally {
      if (token === loadToken.current) setBusy(null);
    }
  }

  // ---- preview ------------------------------------------------------------------------------------------

  const previewState = useMemo<EditState>(() => (mode === "crop" ? { ...state, crop: null, resize: null } : state), [mode, state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    const g = geometry(image.width, image.height, previewState);
    const scale = Math.min(1, PREVIEW_SIDE / Math.max(g.outW, g.outH));
    const pw = Math.max(1, Math.round(g.outW * scale));
    const ph = Math.max(1, Math.round(g.outH * scale));
    try {
      const drawn = renderEdited(image.proxy, previewState, domCanvas, {
        width: pw,
        height: ph,
        originalWidth: image.width,
        originalHeight: image.height,
      });
      canvas.width = pw;
      canvas.height = ph;
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, pw, ph);
      ctx?.drawImage(drawn as unknown as HTMLCanvasElement, 0, 0);
      drawn.width = 0;
      drawn.height = 0;
    } catch {
      // Reported after the draw, not during it.
      setTimeout(() => setError(ERROR_MESSAGES.canvas_unavailable), 0);
    }
  }, [image, previewState]);

  // ---- crop mode ----------------------------------------------------------------------------------------

  const view = image ? viewSize(srcW, srcH, state.rotation) : { w: 0, h: 0 };
  const ratio = aspectId === "original" ? view.w / view.h : (presetById(aspectId)?.ratio ?? null);

  function startCrop() {
    if (!image) return;
    const current = state.crop ?? { x: 0, y: 0, w: srcW, h: srcH };
    setCropRect(sourceRectToView(current, srcW, srcH, state));
    setSizeDraft(null);
    setMode("crop");
    setStatus("Crop mode. Drag the handles, or type exact numbers, then choose Apply crop.");
  }
  function applyCrop() {
    if (!image || !cropRect) return;
    const source = viewRectToSource(cropRect, srcW, srcH, state);
    commit(withCrop(state, source, srcW, srcH));
    setMode("edit");
    setStatus(`Cropped to ${cropRect.w} × ${cropRect.h} pixels.`);
  }
  function cancelCrop() {
    setMode("edit");
    setStatus("Crop cancelled. Nothing changed.");
  }
  function chooseAspect(id: string) {
    setAspectId(id);
    if (!cropRect) return;
    const next = id === "original" ? view.w / view.h : (presetById(id)?.ratio ?? null);
    if (next !== null) setCropRect(fitAspect(cropRect, next, view));
  }
  function typeCrop(field: keyof Rect, value: string) {
    if (!cropRect) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setCropRect(normalizeRect({ ...cropRect, [field]: n }, view, ratio, field === "w" ? "w" : field === "h" ? "h" : undefined));
  }

  // ---- size ---------------------------------------------------------------------------------------------

  function shownSize(field: "w" | "h"): string {
    if (!geo) return "";
    if (sizeDraft) {
      if (sizeDraft.field === field) return sizeDraft.text;
      const typed = Number(sizeDraft.text);
      if (lockAspect && Number.isFinite(typed) && typed > 0) {
        const next = withResize(committed, srcW, srcH, { [sizeDraft.field]: typed }, true);
        const g = geometry(srcW, srcH, next);
        return String(field === "w" ? g.outW : g.outH);
      }
    }
    return String(field === "w" ? geo.outW : geo.outH);
  }
  function commitSize() {
    if (!sizeDraft) return;
    const typed = Number(sizeDraft.text);
    if (Number.isFinite(typed) && typed >= 1) commit(withResize(committed, srcW, srcH, { [sizeDraft.field]: typed }, lockAspect));
    setSizeDraft(null);
  }
  function scaleTo(percent: number) {
    if (!geo) return;
    const base = geometry(srcW, srcH, { ...committed, resize: null });
    commit(withResize(committed, srcW, srcH, { w: Math.round((base.rotW * percent) / 100) }, true));
  }

  // ---- download ------------------------------------------------------------------------------------------

  const plan = image
    ? planExport({ source: image.format, sourceHasAlpha: image.hasAlpha, target: format, unchanged, webpLossless: !!support?.webpLossless, qualityPercent: quality })
    : null;
  const sizeProblem = geo ? outputProblem(geo.outW, geo.outH) : null;
  const keeping = !!plan?.canKeepOriginal && keepOriginal;

  async function download() {
    if (!image || !plan || !geo) return;
    setError(null);
    if (keeping) {
      downloadBlob(new Blob([image.file], { type: image.file.type }), image.file.name);
      void trackDocumentDownloaded(plan.ext);
      setStatus(`Downloaded ${image.file.name}: your original file, unchanged.`);
      return;
    }
    setBusy("Preparing your image. Large pictures can take a few seconds…");
    await paint();
    try {
      const result = await exportImage({ image, state, format, qualityPercent: quality, background: isHexColour(background) ? background : "#ffffff", webpLossless: !!support?.webpLossless });
      const name = exportFileName(image.file.name, OUTPUT_INFO[format].ext);
      downloadBlob(result.blob, name);
      void trackDocumentDownloaded(OUTPUT_INFO[format].ext);
      setStatus(`Downloaded ${name}: ${result.width} × ${result.height} pixels, ${OUTPUT_INFO[format].label}, ${formatBytes(result.blob.size)}.`);
    } catch (err) {
      setError(err instanceof ImageEditError ? ERROR_MESSAGES[err.code] : ERROR_MESSAGES.encode_failed);
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  // ---- messages that explain what a choice costs ----------------------------------------------------------

  const notes: { tone: "info" | "warning"; text: string }[] = [];
  if (image && plan) {
    if (plan.dropsTransparency) notes.push({ tone: "warning", text: "JPEG can't store transparency. Transparent areas will be filled with the colour you choose below (white by default), not black." });
    if (plan.lossy && !keeping) {
      notes.push({
        tone: "info",
        text: `${OUTPUT_INFO[format].label} at ${quality}% is lossy: it shrinks the file by discarding a little detail. The picture is encoded once, from the original pixels. Choose PNG for no loss.`,
      });
    }
    if (image.format === "jpeg" && format === "png") notes.push({ tone: "info", text: "PNG adds no further loss, but it can't bring back detail the JPEG already lost, and the file will be larger." });
    if (isUpscaled(srcW, srcH, state)) notes.push({ tone: "warning", text: "Making a picture larger can't restore detail it never had. It may look soft or blocky." });
    if (image.format === "gif") notes.push({ tone: "info", text: "Only the first frame of an animated GIF is used." });
    if (!keeping) notes.push({ tone: "info", text: "Photo details such as location, camera and colour profile are not copied into the new file, and the picture is saved in standard sRGB colour." });
    if (sizeProblem) notes.push({ tone: "warning", text: ERROR_MESSAGES.export_too_large });
  }

  const hasMultipleFormats = formats.length > 0;
  const field = "field";
  const sectionTitle = "panel-title mb-2";

  // ---- render ------------------------------------------------------------------------------------------

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && !busy) void choose(file);
  }

  if (!image) {
    return (
      <div className="space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <p className="muted text-sm">
          Crop, rotate, flip, resize and adjust one picture, then download it as a picture file. Your picture is edited on this device and is never uploaded.
        </p>
        <FileDropzone accept={FILE_ACCEPT} title="Choose a picture" hint="or drop it here. JPEG, PNG, WebP, GIF, BMP and AVIF files can be opened." disabled={!!busy} onFile={(file) => void choose(file)} />
        <p role="status" aria-live="polite" className={busy ? "notice notice-info" : "sr-only"}>
          {busy ?? status}
        </p>
      </div>
    );
  }

  const cropping = mode === "crop";
  const cropBounds = view;

  return (
    <div
      className="space-y-4"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {pending && (
        <div role="alertdialog" aria-labelledby="replace-title" className="notice notice-warning !block space-y-2">
          <p id="replace-title" className="font-medium">
            Replace the current picture with {pending.file.name}?
          </p>
          <p>Your edits to {image.file.name} will be lost. Choose Keep current picture to carry on editing it.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => adopt(pending)}>
              Replace picture
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                disposeImage(pending);
                setPending(null);
                setStatus("Kept the current picture.");
              }}
            >
              Keep current picture
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        {/* ---- the picture and what you can do to it ---- */}
        <div className="min-w-0 space-y-3">
          <div className={`card overflow-hidden p-3 ${dragging ? "border-blue-600" : ""}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-medium" title={image.file.name}>
                {image.file.name}
              </p>
              <p className="muted text-xs" data-testid="dimensions">
                {cropping ? `Crop area ${cropRect?.w ?? 0} × ${cropRect?.h ?? 0} px` : `Result ${geo?.outW} × ${geo?.outH} px`}
              </p>
            </div>
            {/* The checkerboard shows through transparent areas. */}
            <div className="image-edit-checker relative mx-auto" style={{ width: "100%", maxWidth: `min(${Math.max(geo ? previewWidth(previewState, image) : 300, 320)}px, calc(70vh * ${previewAspect(previewState, image)}))` }}>
              <canvas ref={canvasRef} className="block h-auto w-full" data-testid="preview" aria-label="Preview of the edited picture" role="img" />
              {cropping && cropRect && <CropOverlay rect={cropRect} bounds={cropBounds} ratio={ratio} onChange={setCropRect} />}
            </div>
          </div>

          {cropping && cropRect ? (
            <div className="card space-y-3 p-3" role="group" aria-label="Crop">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ie-aspect" className="mb-1 block text-sm font-medium">
                    Shape
                  </label>
                  <select id="ie-aspect" className={field} value={aspectId} onChange={(e) => chooseAspect(e.target.value)} data-assistant-id="image-edit-aspect">
                    {ASPECT_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    <option value="original">Same shape as the picture</option>
                  </select>
                </div>
                <fieldset className="min-w-0">
                  <legend className="mb-1 text-sm font-medium">Crop area in pixels</legend>
                  <div className="grid grid-cols-4 gap-2">
                    {(
                      [
                        ["x", "Left"],
                        ["y", "Top"],
                        ["w", "Width"],
                        ["h", "Height"],
                      ] as const
                    ).map(([key, label]) => (
                      <div key={key}>
                        <label htmlFor={`ie-crop-${key}`} className="mb-1 block text-xs text-zinc-600 dark:text-zinc-400">
                          {label}
                        </label>
                        <input
                          id={`ie-crop-${key}`}
                          type="number"
                          inputMode="numeric"
                          min={key === "w" || key === "h" ? MIN_CROP : 0}
                          className={`${field} px-2`}
                          value={cropRect[key]}
                          onChange={(e) => typeCrop(key, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                </fieldset>
              </div>
              <p className="muted text-xs">Drag the corners and edges, or focus a handle and use the arrow keys (hold Shift for bigger steps). Nothing changes until you choose Apply crop.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={applyCrop} data-assistant-id="image-edit-apply-crop">
                  Apply crop
                </button>
                <button type="button" className="btn btn-secondary" onClick={cancelCrop}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="card flex flex-wrap gap-2 p-3" role="toolbar" aria-label="Edit tools">
              <button type="button" className="btn btn-secondary" onClick={startCrop} disabled={!!busy} data-assistant-id="image-edit-crop">
                <Icon name="crop" size={18} /> Crop
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => commit(rotateBy(committed, -1))} disabled={!!busy} aria-label="Rotate left 90 degrees">
                <Icon name="rotate-left" size={18} /> Rotate left
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => commit(rotateBy(committed, 1))} disabled={!!busy} aria-label="Rotate right 90 degrees">
                <Icon name="rotate-right" size={18} /> Rotate right
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => commit(flipHorizontal(committed))} disabled={!!busy} aria-pressed={state.flipH}>
                Flip horizontal
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => commit(flipVertical(committed))} disabled={!!busy} aria-pressed={state.flipV}>
                Flip vertical
              </button>
              <span className="mx-1 hidden w-px self-stretch bg-zinc-200 dark:bg-zinc-800 sm:block" aria-hidden />
              <button type="button" className="btn btn-ghost" onClick={undo} disabled={history.index === 0 || !!busy}>
                <Icon name="undo" size={18} /> Undo
              </button>
              <button type="button" className="btn btn-ghost" onClick={redo} disabled={history.index >= history.states.length - 1 || !!busy}>
                <Icon name="redo" size={18} /> Redo
              </button>
            </div>
          )}

          {/* ---- download ---- */}
          <section className="card space-y-3 p-4" aria-labelledby="ie-export-title">
            <h2 id="ie-export-title" className="section-title">
              Download
            </h2>
            {!hasMultipleFormats ? (
              <p className="muted text-sm">Checking which picture formats this browser can save…</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ie-format" className="mb-1 block text-sm font-medium">
                    Format
                  </label>
                  <select id="ie-format" className={field} value={format} onChange={(e) => {
                      setFormat(e.target.value as OutputFormat);
                      setQuality(DEFAULT_QUALITY);
                    }} data-assistant-id="image-edit-format">
                    {formats.map((f) => (
                      <option key={f.format} value={f.format}>
                        {f.optionLabel}
                      </option>
                    ))}
                  </select>
                  <p className="muted mt-1 text-xs">{formats.find((f) => f.format === format)?.note}</p>
                </div>
                {plan?.lossy && !keeping && (
                  <div>
                    <label htmlFor="ie-quality" className="mb-1 block text-sm font-medium">
                      Quality: {quality}%
                    </label>
                    <input id="ie-quality" type="range" className="edit-range" min={50} max={100} step={1} value={quality} onChange={(e) => setQuality(Number(e.target.value))} aria-valuetext={`${quality} percent`} />
                    <p className="muted text-xs">{format === "webp" && support?.webpLossless ? "100% saves WebP losslessly." : "95% is a good balance of detail and size."}</p>
                  </div>
                )}
                {plan?.dropsTransparency && !keeping && (
                  <div>
                    <label htmlFor="ie-bg" className="mb-1 block text-sm font-medium">
                      Fill transparent areas with
                    </label>
                    <input id="ie-bg" type="color" className="field !p-1" value={isHexColour(background) ? background : "#ffffff"} onChange={(e) => setBackground(e.target.value)} />
                  </div>
                )}
              </div>
            )}

            {plan?.canKeepOriginal && (
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={keepOriginal} onChange={(e) => setKeepOriginal(e.target.checked)} />
                <span>
                  Keep my original file as it is (no re-encoding). Untick to save a fresh {OUTPUT_INFO[format].label} copy instead.
                </span>
              </label>
            )}

            <ul className="space-y-2" aria-label="About this download">
              {notes.map((n) => (
                <li key={n.text} className={`notice ${n.tone === "warning" ? "notice-warning" : "notice-info"}`}>
                  {n.text}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-primary btn-lg w-full sm:w-auto" onClick={() => void download()} disabled={!!busy || cropping || !hasMultipleFormats || !!sizeProblem} data-assistant-id="image-edit-download">
                <Icon name="download" size={20} /> {keeping ? "Download original image" : "Download image"}
              </button>
              {cropping && <p className="muted text-xs">Apply or cancel the crop first.</p>}
            </div>
            <p className="muted text-xs">
              {plan ? `Saves a ${OUTPUT_INFO[format].label} file${keeping ? " identical to your original" : ` of ${geo?.outW} × ${geo?.outH} pixels`}.` : ""} It is a picture file, not a PDF.
            </p>
          </section>

          <p role="status" aria-live="polite" className={busy ? "notice notice-info" : "muted text-sm"} data-testid="status">
            {busy ?? status}
          </p>
        </div>

        {/* ---- the controls ---- */}
        <fieldset disabled={cropping || !!busy} className="min-w-0 space-y-4 border-0 p-0">
          <section className="card p-4" aria-labelledby="ie-size-info">
            <h2 id="ie-size-info" className={sectionTitle}>
              Picture
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="muted">Original</dt>
              <dd data-testid="original-size">
                {image.width} × {image.height} px ({megapixels(image.width, image.height)}, {INPUT_FORMAT_LABEL[image.format]}, {formatBytes(image.file.size)})
              </dd>
              <dt className="muted">Result</dt>
              <dd data-testid="result-size">
                {geo?.outW} × {geo?.outH} px
              </dd>
              {image.hasAlpha && (
                <>
                  <dt className="muted">Transparency</dt>
                  <dd>Has transparent areas</dd>
                </>
              )}
            </dl>
          </section>

          <section className="card space-y-3 p-4" aria-labelledby="ie-resize-title">
            <h2 id="ie-resize-title" className={sectionTitle}>
              Resize
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="ie-w" className="mb-1 block text-sm font-medium">
                  Width (px)
                </label>
                <input
                  id="ie-w"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  className={field}
                  value={shownSize("w")}
                  onChange={(e) => setSizeDraft({ field: "w", text: e.target.value })}
                  onBlur={commitSize}
                  onKeyDown={(e) => e.key === "Enter" && commitSize()}
                />
              </div>
              <div>
                <label htmlFor="ie-h" className="mb-1 block text-sm font-medium">
                  Height (px)
                </label>
                <input
                  id="ie-h"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  className={field}
                  value={shownSize("h")}
                  onChange={(e) => setSizeDraft({ field: "h", text: e.target.value })}
                  onBlur={commitSize}
                  onKeyDown={(e) => e.key === "Enter" && commitSize()}
                />
              </div>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} />
              Keep the picture&apos;s shape (lock aspect ratio)
            </label>
            <div className="flex flex-wrap gap-2">
              {[75, 50, 25].map((p) => (
                <button key={p} type="button" className="btn btn-secondary" onClick={() => scaleTo(p)}>
                  {p}%
                </button>
              ))}
              <button type="button" className="btn btn-ghost" onClick={() => commit({ ...committed, resize: null })} disabled={!committed.resize}>
                Original size
              </button>
            </div>
            <p className="muted text-xs">Starts at the picture&apos;s own size. Making it smaller is safe; making it larger can&apos;t add detail that isn&apos;t there. Limit: {16384} px on a side.</p>
          </section>

          <section className="card space-y-2 p-4" aria-labelledby="ie-adjust-title">
            <h2 id="ie-adjust-title" className={sectionTitle}>
              Brightness and contrast
            </h2>
            {(
              [
                ["brightness", "Brightness"],
                ["contrast", "Contrast"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={`ie-${key}`} className="mb-0 block text-sm font-medium">
                  {label}: {state[key]}
                </label>
                <input
                  id={`ie-${key}`}
                  type="range"
                  className="edit-range"
                  min={-100}
                  max={100}
                  step={1}
                  value={state[key]}
                  onChange={(e) => setDraft({ brightness: key === "brightness" ? Number(e.target.value) : state.brightness, contrast: key === "contrast" ? Number(e.target.value) : state.contrast })}
                  onPointerUp={() => draft && commit(withAdjustments(committed, draft.brightness, draft.contrast))}
                  onKeyUp={() => draft && commit(withAdjustments(committed, draft.brightness, draft.contrast))}
                  onBlur={() => draft && commit(withAdjustments(committed, draft.brightness, draft.contrast))}
                  aria-valuetext={`${state[key]}`}
                />
              </div>
            ))}
            <p className="muted text-xs">The same brightness and contrast curve as the scanner&apos;s page editor. Applied once, to the original, when you download.</p>
          </section>

          <section className="card space-y-2 p-4" aria-labelledby="ie-file-title">
            <h2 id="ie-file-title" className={sectionTitle}>
              Start over or change picture
            </h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={resetEdits} disabled={unchanged && !draft}>
                Reset edits
              </button>
              <button type="button" className="btn btn-secondary" onClick={restoreOriginal} disabled={history.states.length === 1 && !draft}>
                Restore original
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => replaceInput.current?.click()}>
                Replace picture
              </button>
              <input
                ref={replaceInput}
                type="file"
                accept={FILE_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-label="Choose another picture"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void choose(file);
                }}
              />
            </div>
            <p className="muted text-xs">Reset edits can be undone. Restore original goes back to the picture as you opened it and clears the undo list. Your original file is never changed.</p>
          </section>
        </fieldset>
      </div>
    </div>
  );
}

function previewWidth(state: EditState, image: LoadedImage): number {
  const g = geometry(image.width, image.height, state);
  return Math.min(PREVIEW_SIDE, g.outW);
}
function previewAspect(state: EditState, image: LoadedImage): number {
  const g = geometry(image.width, image.height, state);
  return g.outW / g.outH;
}

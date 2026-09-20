"use client";

// Create a signature by drawing it (mouse, pen or finger), typing it, or
// uploading an image of one. The result is a transparent PNG handed back to the
// annotation editor to place on the page. Nothing is uploaded or stored.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_SIGNATURE_UPLOAD_BYTES,
  processUploadedSignature,
  renderTypedSignature,
  trimToPng,
  type SignatureImage,
} from "@/utils/scanner/signature";
import { SIGNATURE_FONT_STACK } from "@/utils/scanner/annotations";
import { clearSavedSignature, loadSavedSignature, saveSignature } from "@/utils/scanner/signatureStore";

export type Tab = "draw" | "type" | "upload";

const TABS: { value: Tab; label: string }[] = [
  { value: "draw", label: "Draw Signature" },
  { value: "type", label: "Type" },
  { value: "upload", label: "Upload Signature" },
];

const INK_COLORS = [
  { value: "#111111", label: "Black" },
  { value: "#1a3fa8", label: "Blue" },
] as const;

// Drawing surface: fixed logical size (so a signature is the same quality on any
// screen) shown scaled to the dialog's width.
const PAD_WIDTH = 900;
const PAD_HEIGHT = 300;
const PEN_WIDTH = 5;

export function SignatureDialog({
  lastSignature,
  onApply,
  onCancel,
  initialTab,
}: {
  lastSignature: SignatureImage | null;
  // `method` is which tab produced it (absent when an earlier signature is reused).
  onApply: (signature: SignatureImage, method?: Tab) => void;
  onCancel: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "draw");
  const [color, setColor] = useState<string>(INK_COLORS[0].value);
  const [hasInk, setHasInk] = useState(false);
  const [typed, setTyped] = useState("");
  const [upload, setUpload] = useState<{ file: File; result: SignatureImage | null } | null>(null);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A signature the person chose to keep on this device (opt-in, local only).
  // The dialog only exists after a click, so reading storage here is safe.
  const [saved, setSaved] = useState<SignatureImage | null>(() => loadSavedSignature());
  const [saveOnDevice, setSaveOnDevice] = useState(false);

  const padRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<{ lastX: number; lastY: number; midX: number; midY: number; moved: boolean } | null>(null);
  const firstTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstTabRef.current?.focus();
    // Capture phase so Escape closes only this dialog, not the editors under it.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onCancel();
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rendered to a canvas, so only redone when what it depends on changes.
  const typedResult = useMemo(
    () => (tab === "type" ? renderTypedSignature(typed, color) : null),
    [tab, typed, color],
  );

  // ---- drawing --------------------------------------------------------------

  function padPoint(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePadDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The stroke still draws without capture; it just ends if the pointer leaves the pad.
    }
    const { x, y } = padPoint(e);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = PEN_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokeRef.current = { lastX: x, lastY: y, midX: x, midY: y, moved: false };
    setError(null);
  }

  function handlePadMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = strokeRef.current;
    const ctx = e.currentTarget.getContext("2d");
    if (!stroke || !ctx) return;
    const { x, y } = padPoint(e);
    const midX = (stroke.lastX + x) / 2;
    const midY = (stroke.lastY + y) / 2;
    ctx.beginPath();
    ctx.moveTo(stroke.midX, stroke.midY);
    ctx.quadraticCurveTo(stroke.lastX, stroke.lastY, midX, midY);
    ctx.stroke();
    stroke.lastX = x;
    stroke.lastY = y;
    stroke.midX = midX;
    stroke.midY = midY;
    stroke.moved = true;
    if (!hasInk) setHasInk(true);
  }

  function handlePadUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    const ctx = e.currentTarget.getContext("2d");
    if (!stroke || !ctx) return;
    if (!stroke.moved) {
      // A tap leaves a dot.
      ctx.beginPath();
      ctx.arc(stroke.lastX, stroke.lastY, PEN_WIDTH / 2, 0, Math.PI * 2);
      ctx.fill();
      setHasInk(true);
    } else {
      // Finish the line out to where the pointer was actually released, not
      // just the last move sample, so a stroke doesn't stop short.
      const end = padPoint(e);
      ctx.beginPath();
      ctx.moveTo(stroke.midX, stroke.midY);
      ctx.quadraticCurveTo(stroke.lastX, stroke.lastY, end.x, end.y);
      ctx.stroke();
    }
  }

  function clearPad() {
    const canvas = padRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  // ---- upload ---------------------------------------------------------------

  async function processUpload(file: File, removeBackground: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await processUploadedSignature(file, removeBackground);
      setUpload({ file, result });
      if (!result) setError("No signature was found in that image. Try a clearer picture on white paper.");
    } catch {
      setUpload(null);
      setError("That image couldn't be read. Try a different file.");
    } finally {
      setBusy(false);
    }
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG or JPG).");
      return;
    }
    if (file.size > MAX_SIGNATURE_UPLOAD_BYTES) {
      setError("That image is too large. Please use one under 5MB.");
      return;
    }
    void processUpload(file, removeWhite);
  }

  // ---- apply ----------------------------------------------------------------

  function currentResult(): SignatureImage | null {
    if (tab === "draw") return padRef.current ? trimToPng(padRef.current) : null;
    if (tab === "type") return typedResult;
    return upload?.result ?? null;
  }

  const canApply = tab === "draw" ? hasInk : tab === "type" ? typedResult !== null : upload?.result != null;

  function handleApply() {
    const result = currentResult();
    if (!result) {
      setError(tab === "draw" ? "Draw your signature first." : "Nothing to apply yet.");
      return;
    }
    if (saveOnDevice && !saveSignature(result)) {
      // Storage was blocked or full: still place the signature, just say so.
      setError("The signature was added, but couldn't be saved on this device.");
    }
    onApply(result, tab);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add signature"
      className="fixed inset-0 z-[80] flex items-end bg-black/60 sm:items-center sm:justify-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="flex max-h-full w-full flex-col gap-4 overflow-y-auto rounded-t-xl bg-white p-4 dark:bg-zinc-900 sm:max-w-lg sm:rounded-xl">
        <div>
          <h2 className="text-base font-semibold">Add your signature</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Draw your signature or upload an existing signature image.</p>
        </div>

        {saved && (
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => onApply(saved)}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg border border-zinc-300 p-2 text-left text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <span className="flex h-12 w-28 shrink-0 items-center justify-center rounded bg-white p-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
                <img src={saved.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
              </span>
              <span>Use my saved signature</span>
            </button>
            <button
              type="button"
              onClick={() => {
                clearSavedSignature();
                setSaved(null);
              }}
              aria-label="Remove my saved signature from this device"
              className="min-h-11 shrink-0 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Remove
            </button>
          </div>
        )}

        {lastSignature && lastSignature.dataUrl !== saved?.dataUrl && (
          <button
            type="button"
            onClick={() => onApply(lastSignature)}
            className="flex min-h-11 items-center gap-3 rounded-lg border border-zinc-300 p-2 text-left text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <span className="flex h-12 w-28 shrink-0 items-center justify-center rounded bg-white p-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- client-generated data URL */}
              <img src={lastSignature.dataUrl} alt="" className="max-h-full max-w-full object-contain" />
            </span>
            <span>Use the signature from earlier</span>
          </button>
        )}

        <div role="tablist" aria-label="Signature method" className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          {TABS.map((t, i) => (
            <button
              key={t.value}
              ref={i === 0 ? firstTabRef : undefined}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => {
                setTab(t.value);
                setError(null);
              }}
              className={`min-h-11 flex-1 rounded-md px-2 text-center text-sm font-medium leading-tight ${
                tab === t.value ? "bg-white shadow-sm dark:bg-zinc-950" : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {(tab === "draw" || tab === "type") && (
          <div className="flex items-center gap-2" role="group" aria-label="Ink colour">
            <span className="text-sm text-zinc-500">Ink</span>
            {INK_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.label}
                aria-pressed={color === c.value}
                onClick={() => setColor(c.value)}
                className="flex h-11 w-11 items-center justify-center rounded-full"
              >
                <span
                  className={`h-7 w-7 rounded-full border-2 ${color === c.value ? "border-blue-600 ring-2 ring-blue-300" : "border-zinc-300"}`}
                  style={{ backgroundColor: c.value }}
                />
              </button>
            ))}
          </div>
        )}

        {tab === "draw" && (
          <div>
            <canvas
              ref={padRef}
              width={PAD_WIDTH}
              height={PAD_HEIGHT}
              aria-label="Signature drawing area"
              onPointerDown={handlePadDown}
              onPointerMove={handlePadMove}
              onPointerUp={handlePadUp}
              onPointerCancel={handlePadUp}
              className="w-full cursor-crosshair rounded-lg border border-dashed border-zinc-400 bg-white"
              style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}`, touchAction: "none" }}
            />
            <p className="mt-1 text-xs text-zinc-500">Sign above using your mouse, finger or pen.</p>
          </div>
        )}

        {tab === "type" && (
          <div className="space-y-2">
            <input
              type="text"
              value={typed}
              maxLength={40}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type your name"
              aria-label="Type your signature"
              className="min-h-11 w-full rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
            />
            <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-dashed border-zinc-400 bg-white p-2">
              {typedResult ? (
                // eslint-disable-next-line @next/next/no-img-element -- client-generated data URL
                <img src={typedResult.dataUrl} alt="Typed signature preview" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-sm text-zinc-400" style={{ fontFamily: SIGNATURE_FONT_STACK, fontStyle: "italic" }}>
                  Your signature appears here
                </span>
              )}
            </div>
          </div>
        )}

        {tab === "upload" && (
          <div className="space-y-2">
            <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
              {upload ? "Choose a different image" : "Choose an image of your signature"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={removeWhite}
                onChange={(e) => {
                  setRemoveWhite(e.target.checked);
                  if (upload) void processUpload(upload.file, e.target.checked);
                }}
                className="h-4 w-4 accent-blue-600"
              />
              Make the white background transparent
            </label>
            <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-dashed border-zinc-400 bg-white p-2">
              {busy ? (
                <span className="text-sm text-zinc-500">Reading image…</span>
              ) : upload?.result ? (
                // eslint-disable-next-line @next/next/no-img-element -- client-generated data URL
                <img src={upload.result.dataUrl} alt="Uploaded signature preview" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-sm text-zinc-400">A photo or scan on white paper works best</span>
              )}
            </div>
          </div>
        )}

        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={saveOnDevice}
            onChange={(e) => setSaveOnDevice(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
          />
          <span>
            Save this signature on this device
            <span className="block text-xs text-zinc-500">
              Kept in this browser only, so you don&apos;t have to redraw it next time. You can remove it any time.
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          {tab === "draw" && (
            <button
              type="button"
              onClick={clearPad}
              disabled={!hasInk}
              className="min-h-11 rounded-md px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-md px-4 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canApply || busy}
            className="min-h-11 flex-1 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

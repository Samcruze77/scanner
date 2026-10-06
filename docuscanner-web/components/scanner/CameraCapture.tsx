"use client";

import { Icon } from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";
import { captureVideoFrame, type CapturedImage } from "@/utils/scanner/image";
import { distance, polygonArea, type Quad } from "@/utils/scanner/geometry";
import { debugLog, isScannerDebug } from "@/utils/scanner/debugLog";
import {
  MIN_COMFORTABLE_AREA_RATIO,
  OUTSIDE_EDGE_FRACTION,
  TOUCHING_EDGE_FRACTION,
} from "@/utils/scanner/framing";

// Ask for a high starting mode instead of the browser default (~640x480). These
// are `ideal` values, so a device that can't reach them still opens at its
// closest mode; no aspectRatio or exact value is forced (that makes some
// browsers pick a cropped or lower mode). refineResolution() then reads the
// real track capabilities and tops the stream up to the sensor's best mode.
const REQUEST_WIDTH = 4096;
const REQUEST_HEIGHT = 3072;
const HIGH_RES_VIDEO: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: REQUEST_WIDTH },
  height: { ideal: REQUEST_HEIGHT },
};

// Largest long side we ask for; matches the capture cap in utils/scanner/image.ts.
const MAX_LONG_SIDE = 4096;

const DETECT_INTERVAL_MS = 700;
// Guidance-only copy of the frame; the captured scan never comes from it.
const DETECT_WIDTH = 400;
// Opposite sides of a real page differ by less than this (perspective allowed);
// anything wilder is background clutter, not a page.
const MIN_SIDE_RATIO = 0.6;
const READY_STREAK = 2;

type Guidance = "none" | "small" | "outside" | "touching" | "ready";
type TrackExtras = MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min: number; max: number } };
type SettingsExtras = MediaTrackSettings & { focusMode?: string; zoom?: number };

const MESSAGES: Record<Guidance | "start", string> = {
  start: "Move back until the entire document fits inside the frame.",
  none: "Document not detected. Move back until the entire document fits inside the frame, or capture manually.",
  small: "The document looks small. Move back until it fits, then come a little closer if text looks tiny.",
  outside: "Part of the document is outside the frame. Move back until the entire document fits.",
  touching: "The document is touching the edge. Move back a little to leave a margin.",
  ready: "Ready to scan. Hold steady and capture.",
};

const REQUESTED_LABEL = `ideal ${REQUEST_WIDTH}x${REQUEST_HEIGHT} + rear camera`;

async function openCamera(): Promise<{ stream: MediaStream; requested: string }> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: HIGH_RES_VIDEO, audio: false });
    return { stream, requested: REQUESTED_LABEL };
  } catch (err) {
    // Only constraint failures are worth a retry; permission/hardware errors
    // must surface unchanged.
    if (err instanceof DOMException && (err.name === "OverconstrainedError" || err.name === "NotReadableError")) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      return { stream, requested: `${REQUESTED_LABEL} FAILED (${err.name}); retried with rear camera only` };
    }
    throw err;
  }
}

// The browser may have opened a lower mode than the sensor offers (several
// Android builds start at 640x480/720p whatever `ideal` says). When the track
// advertises a larger mode, ask for it at the stream's own aspect ratio and
// orientation; keep the old mode if the browser doesn't actually improve.
async function refineResolution(track: MediaStreamTrack): Promise<string> {
  try {
    const caps = track.getCapabilities?.() as TrackExtras | undefined;
    const before = track.getSettings();
    if (!caps?.width?.max || !before.width || !before.height) return "skipped: browser exposes no width/height capabilities";

    const capLong = Math.max(caps.width.max, caps.height?.max ?? 0);
    const targetLong = Math.min(capLong, MAX_LONG_SIDE);
    const beforeLong = Math.max(before.width, before.height);
    if (beforeLong >= targetLong * 0.95) return "not needed: already at the best mode the track reports";

    const aspect = before.width / before.height;
    let w = aspect >= 1 ? targetLong : Math.round(targetLong * aspect);
    let h = aspect >= 1 ? Math.round(targetLong / aspect) : targetLong;
    w = Math.min(w, caps.width.max);
    if (caps.height?.max) h = Math.min(h, caps.height.max);

    await track.applyConstraints({ width: { ideal: w }, height: { ideal: h } });
    const after = track.getSettings();
    const afterLong = Math.max(after.width ?? 0, after.height ?? 0);
    if (afterLong < beforeLong) {
      await track.applyConstraints({ width: { ideal: before.width }, height: { ideal: before.height } });
      return `failed: asked ${w}x${h}, browser gave ${after.width}x${after.height}; reverted to ${before.width}x${before.height}`;
    }
    if (afterLong === beforeLong) return `no change: asked ${w}x${h}, browser kept ${before.width}x${before.height}`;
    return `succeeded: ${before.width}x${before.height} -> ${after.width}x${after.height}`;
  } catch (err) {
    // keep whatever mode the browser opened
    return `error: ${err instanceof Error ? err.name : "unknown"}; kept the opened mode`;
  }
}

// Continuous autofocus keeps printed text sharp without hunting; only requested
// where the track advertises it (Chrome on Android, some webcams). iOS Safari
// does not expose focusMode and already autofocuses continuously. Never fatal.
async function enableContinuousFocus(track: MediaStreamTrack) {
  try {
    const caps = track.getCapabilities?.() as TrackExtras | undefined;
    if (caps?.focusMode?.includes("continuous")) {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
    }
  } catch {
    // unsupported or rejected: keep the browser default focus behaviour
  }
}

function describeTrack(
  track: MediaStreamTrack,
  extra: { requested: string; openedMode: string; topUp: string; video: HTMLVideoElement | null },
) {
  const caps = (track.getCapabilities?.() ?? {}) as TrackExtras;
  const set = track.getSettings() as SettingsExtras;
  const aspect = set.width && set.height ? (set.width / set.height).toFixed(4) : "unknown";
  return {
    requested: extra.requested,
    openedMode: extra.openedMode,
    resolutionTopUp: extra.topUp,
    selectedMode: `${set.width}x${set.height}`,
    width: set.width,
    height: set.height,
    aspectRatio: aspect,
    frameRate: set.frameRate ? Math.round(set.frameRate) : "unreported",
    facingMode: set.facingMode ?? "unreported",
    sensorMaxMode: `${caps.width?.max ?? "?"}x${caps.height?.max ?? "?"}`,
    videoElementFrame: extra.video ? `${extra.video.videoWidth}x${extra.video.videoHeight}` : "n/a",
    focusSupported: caps.focusMode ?? "not exposed (expected on iOS Safari)",
    focusActive: set.focusMode ?? "unreported",
    zoomSupported: caps.zoom ? `${caps.zoom.min}-${caps.zoom.max}` : "not exposed",
    zoomActive: set.zoom ?? "none (never applied)",
    settings: set,
    capabilities: caps,
  };
}

function classify(quad: Quad, w: number, h: number): Guidance {
  const [tl, tr, br, bl] = quad;
  const side = (a: number, b: number) => (Math.max(a, b) > 0 ? Math.min(a, b) / Math.max(a, b) : 0);
  if (side(distance(tl, tr), distance(bl, br)) < MIN_SIDE_RATIO) return "none";
  if (side(distance(tl, bl), distance(tr, br)) < MIN_SIDE_RATIO) return "none";

  const edge = Math.min(...quad.map((p) => Math.min(p.x / w, (w - p.x) / w, p.y / h, (h - p.y) / h)));
  if (edge < OUTSIDE_EDGE_FRACTION) return "outside";
  if (edge < TOUCHING_EDGE_FRACTION) return "touching";
  if (polygonArea(quad) / (w * h) < MIN_COMFORTABLE_AREA_RATIO) return "small";
  return "ready";
}

export function CameraCapture({
  onCapture,
  onClose,
  onError,
}: {
  onCapture: (captured: CapturedImage) => void;
  onClose: () => void;
  onError: (reason: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const readyStreak = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        onError("unsupported");
        return;
      }
      try {
        const { stream, requested } = await openCamera();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
        if (track) {
          const opened = track.getSettings();
          const openedMode = `${opened.width}x${opened.height}`;
          const topUp = await refineResolution(track);
          await enableContinuousFocus(track);
          if (!cancelled && isScannerDebug()) {
            const info = describeTrack(track, { requested, openedMode, topUp, video: videoRef.current });
            debugLog("camera", info);
            setDiag(
              `requested ${info.requested}\nopened ${info.openedMode} -> selected ${info.selectedMode} (${info.aspectRatio}) @ ${info.frameRate}fps\n` +
                `top-up ${info.resolutionTopUp}\nfacing ${info.facingMode}, sensor max ${info.sensorMaxMode}\n` +
                `focus ${JSON.stringify(info.focusSupported)} active ${info.focusActive}\n` +
                `zoom ${info.zoomSupported} active ${info.zoomActive}`,
            );
          }
        }
      } catch (err) {
        const reason = err instanceof DOMException ? err.name : "camera_error";
        onError(reason);
      }
    }

    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // onError/onCapture are stable callbacks from the parent (useCallback) --
    // intentionally not in deps so this doesn't restart the camera stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live page detection on a small copy of the frame, only to guide the user.
  // The captured scan never comes from this canvas.
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let busy = false;
    const work = document.createElement("canvas");

    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (busy || stopped || !video || !video.videoWidth) return;
      busy = true;
      try {
        const scale = Math.min(1, DETECT_WIDTH / Math.max(video.videoWidth, video.videoHeight));
        work.width = Math.round(video.videoWidth * scale);
        work.height = Math.round(video.videoHeight * scale);
        work.getContext("2d")?.drawImage(video, 0, 0, work.width, work.height);
        const { detectDocumentQuad } = await import("@/utils/scanner/detection");
        const result = detectDocumentQuad(work);
        if (stopped) return;
        let next: Guidance = "none";
        let q: Quad | null = null;
        if (result) {
          // detection works in `work` pixels; store in video pixels for the overlay
          q = result.quad.map((p) => ({ x: p.x / scale, y: p.y / scale })) as Quad;
          next = classify(q, video.videoWidth, video.videoHeight);
          if (next === "none") q = null;
        }
        // "Ready" must hold for consecutive checks so it doesn't flicker.
        readyStreak.current = next === "ready" ? readyStreak.current + 1 : 0;
        setQuad(q);
        setGuidance((prev) => (next === "ready" && readyStreak.current < READY_STREAK ? (prev ?? "touching") : next));
      } catch {
        // guidance is best-effort; never interrupt scanning
      } finally {
        busy = false;
      }
    }, DETECT_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [ready]);

  // Layout follows the real video dimensions, and the stream can change them
  // (device rotation, the resolution top-up), so listen for `resize` too.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      if (!v.videoWidth) return;
      setSize((p) => (p && p.w === v.videoWidth && p.h === v.videoHeight ? p : { w: v.videoWidth, h: v.videoHeight }));
    };
    v.addEventListener("loadedmetadata", sync);
    v.addEventListener("resize", sync);
    sync();
    return () => {
      v.removeEventListener("loadedmetadata", sync);
      v.removeEventListener("resize", sync);
    };
  }, []);

  function handleCapture() {
    if (!videoRef.current) return;
    onCapture(captureVideoFrame(videoRef.current));
  }

  function handleClose() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onClose();
  }

  const ratio = size ? size.w / size.h : 3 / 4;
  const isReady = guidance === "ready";
  const stroke = isReady ? "#22c55e" : quad ? "#f59e0b" : "rgba(255,255,255,0.85)";
  const message = MESSAGES[guidance ?? "start"];

  return (
    <div className="space-y-3">
      <div
        className="relative mx-auto overflow-hidden rounded-xl bg-black"
        // Wrapper matches the real camera aspect ratio (capped to 70% of the
        // viewport height) so the preview shows the whole frame, uncropped.
        style={{ aspectRatio: ratio, width: `min(100%, ${70 * ratio}vh)` }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-contain"
        />
        {ready && size && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {quad ? (
              <polygon
                points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={isReady ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)"}
                stroke={stroke}
                strokeWidth={Math.max(2, size.w * 0.004)}
                strokeLinejoin="round"
              />
            ) : (
              <rect
                x={size.w * 0.08}
                y={size.h * 0.08}
                width={size.w * 0.84}
                height={size.h * 0.84}
                rx={size.w * 0.015}
                fill="none"
                stroke={stroke}
                strokeWidth={Math.max(2, size.w * 0.004)}
                strokeDasharray={`${size.w * 0.03} ${size.w * 0.02}`}
              />
            )}
          </svg>
        )}
        {diag && (
          <pre className="pointer-events-none absolute left-1 top-1 max-w-full whitespace-pre-wrap rounded bg-black/70 p-1 text-[10px] leading-tight text-white">
            {diag}
          </pre>
        )}
        {!ready && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white">
            Starting camera…
          </p>
        )}
      </div>
      {ready && (
        <p
          role="status"
          className={`text-center text-sm ${isReady ? "font-medium text-green-600" : "text-fg-muted"}`}
        >
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleCapture}
          disabled={!ready}
          className="btn btn-primary btn-lg flex-1 sm:flex-none"
        >
          <Icon name="camera" size={20} />
          Capture page
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="btn btn-secondary btn-lg"
        >
          Done
        </button>
      </div>
    </div>
  );
}

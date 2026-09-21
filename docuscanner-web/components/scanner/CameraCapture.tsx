"use client";

import { Icon } from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";
import { captureVideoFrame, type CapturedImage } from "@/utils/scanner/image";

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

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        onError("unsupported");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
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

  function handleCapture() {
    if (!videoRef.current) return;
    onCapture(captureVideoFrame(videoRef.current));
  }

  function handleClose() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onClose();
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-[3/4] w-full object-cover sm:aspect-video"
        />
        {!ready && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white">
            Starting camera…
          </p>
        )}
      </div>
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

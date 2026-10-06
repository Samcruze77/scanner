"use client";

import { useState, useSyncExternalStore } from "react";
import { isScannerDebug, readDebugLog, SCANNER_DEBUG_EVENT } from "@/utils/scanner/debugLog";

function subscribe(onChange: () => void) {
  window.addEventListener(SCANNER_DEBUG_EVENT, onChange);
  return () => window.removeEventListener(SCANNER_DEBUG_EVENT, onChange);
}

// Debug-only readout of what the scanner really did (camera mode, captured
// frame, processed scan, PDF contents) with a Copy button, so results can be
// sent from a phone. Renders nothing unless isScannerDebug().
export function ScannerDebugPanel() {
  // The count is the snapshot (the log array is appended to in place); -1 is the
  // server/hydration value so nothing renders until the client takes over.
  const count = useSyncExternalStore(subscribe, () => readDebugLog().length, () => -1);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");

  if (count < 0 || !isScannerDebug()) return null;
  const entries = readDebugLog();

  const text = JSON.stringify(
    {
      userAgent: navigator.userAgent,
      screen: `${screen.width}x${screen.height} @${window.devicePixelRatio}x`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      entries,
    },
    null,
    2,
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <section aria-label="Scanner diagnostics" className="card space-y-2 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <strong>Scanner diagnostics (debug mode)</strong>
        <button type="button" onClick={copy} className="btn btn-secondary">
          {copied === "ok" ? "Copied" : copied === "failed" ? "Copy failed: select the text" : "Copy diagnostics"}
        </button>
      </div>
      <textarea readOnly value={text} rows={10} className="w-full font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
    </section>
  );
}

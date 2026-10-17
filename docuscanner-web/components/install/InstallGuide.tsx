"use client";

// "Keep FreePDFScanner close": numbered steps for the visitor's own device and browser. It opens on what we
// detect, says so, and lets the person pick another device or browser (detection is a guess). The browser's
// own install prompt is offered only from the "Install now" button, and only when the browser has one ready;
// everywhere else the manual steps are the whole answer. Nothing is called "installed" except after the
// browser's own appinstalled event.

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icons";
import { BROWSERS_BY_OS, BROWSER_LABEL, GUIDE_SOURCES, OS_OPTIONS, guideFor } from "@/utils/install/guides";
import { currentEnvironment, detect, type BrowserId, type OsId } from "@/utils/install/platform";
import { canPrompt, promptInstall, subscribeInstall, wasInstalled } from "@/utils/install/prompt";

type View = "steps" | "pick";

export function InstallGuide({ onClose }: { onClose: () => void }) {
  const detected = useMemo(() => detect(currentEnvironment()), []);
  const [os, setOs] = useState<OsId>(detected.os);
  const [browser, setBrowser] = useState<BrowserId>(detected.browser);
  const [view, setView] = useState<View>("steps");
  const [status, setStatus] = useState<string | null>(null);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Element | null>(null);

  const promptReady = useSyncExternalStore(subscribeInstall, canPrompt, () => false);
  const installed = useSyncExternalStore(subscribeInstall, wasInstalled, () => false);
  const guide = guideFor(os, browser);
  const isThisDevice = os === detected.os && browser === detected.browser;
  const browsers = BROWSERS_BY_OS[os];

  useEffect(() => {
    returnTo.current = document.activeElement;
    dialogRef.current?.focus();
    const root = dialogRef.current;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      // Keep Tab inside the dialog.
      const items = [...root.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]')].filter((el) => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus();
    };
  }, [onClose]);

  async function installNow() {
    setStatus("Waiting for your browser...");
    const result = await promptInstall();
    if (result === "accepted") setStatus("Your browser is adding FreePDFScanner. This page will say so when it is done.");
    else if (result === "dismissed") setStatus("No problem. You can follow the steps below any time.");
    else setStatus("Your browser could not open its install window. Please follow the steps below.");
  }

  function chooseOs(next: OsId) {
    setOs(next);
    const list = BROWSERS_BY_OS[next];
    if (!list.includes(browser)) setBrowser(list[0]);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="card flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-b-none shadow-2xl outline-none sm:rounded-b-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-start gap-2 border-b p-4" style={{ borderColor: "var(--border)" }}>
          {view === "pick" && (
            <button type="button" onClick={() => setView("steps")} className="btn btn-ghost -ml-2 shrink-0" aria-label="Back to the steps">
              <span aria-hidden>&larr;</span> Back
            </button>
          )}
          <h2 id={titleId} className="min-w-0 flex-1 text-base font-semibold leading-6">
            {view === "pick" ? "Choose your device and browser" : guide.title}
          </h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon -mr-2 -mt-1 shrink-0" aria-label="Close">
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm leading-6">
          {installed && (
            <p role="status" className="notice notice-success mb-3">
              FreePDFScanner is installed on this device.
            </p>
          )}

          {view === "pick" ? (
            <div className="space-y-4">
              <fieldset>
                <legend className="mb-2 font-medium">Your device</legend>
                <div className="flex flex-col gap-2">
                  {OS_OPTIONS.map((o) => (
                    <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3" style={{ borderColor: "var(--border)" }}>
                      <input type="radio" name="install-os" checked={os === o.id} onChange={() => chooseOs(o.id)} className="h-4 w-4" />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 font-medium">Your browser</legend>
                <div className="flex flex-col gap-2">
                  {browsers.map((b) => (
                    <label key={b} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3" style={{ borderColor: "var(--border)" }}>
                      <input type="radio" name="install-browser" checked={browser === b} onChange={() => setBrowser(b)} className="h-4 w-4" />
                      {BROWSER_LABEL[b]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="button" onClick={() => setView("steps")} className="btn btn-primary w-full">
                Show the steps
              </button>
            </div>
          ) : (
            <>
              <p className="muted mb-3">
                {isThisDevice && detected.os !== "other" ? "This looks like " : "Showing steps for "}
                <strong className="text-[color:var(--text)]">
                  {OS_OPTIONS.find((o) => o.id === os)?.label}, {BROWSER_LABEL[browser]}
                </strong>
                .{" "}
                <button type="button" onClick={() => setView("pick")} className="font-medium text-blue-700 underline underline-offset-2 dark:text-blue-400">
                  {isThisDevice ? "Not right? Change" : "Change"}
                </button>
              </p>

              {promptReady && isThisDevice && !installed && (
                <div className="mb-4">
                  <button type="button" onClick={installNow} className="btn btn-primary w-full">
                    Install now
                  </button>
                  <p className="muted mt-1 text-xs">Your browser can do this in one step. Or follow the steps below.</p>
                </div>
              )}
              {status && (
                <p role="status" className="notice notice-info mb-3">
                  {status}
                </p>
              )}

              <ol className="list-decimal space-y-2 pl-5">
                {guide.steps.map((s, i) => (
                  <li key={i} className="pl-1">
                    {s}
                  </li>
                ))}
              </ol>
              {guide.note && <p className="muted mt-3 text-xs">{guide.note}</p>}
              <p data-guide-uncertainty className="muted mt-2 text-xs">
                These steps follow each browser maker&apos;s help pages. Menu names change between versions, and we have not checked every version on a real device. If yours looks different, use &ldquo;I can&apos;t find it&rdquo; below.
              </p>

              <details className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                <summary className="cursor-pointer font-medium">I can&apos;t find it</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {guide.trouble.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </details>

              <details className="mt-3 text-xs">
                <summary className="muted cursor-pointer">Where these steps come from</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {GUIDE_SOURCES.map((s) => (
                    <li key={s.href}>
                      <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline dark:text-blue-400">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>

        <div className="flex justify-end border-t p-3" style={{ borderColor: "var(--border)" }}>
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

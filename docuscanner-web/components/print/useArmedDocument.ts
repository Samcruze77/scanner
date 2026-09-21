"use client";

// Keeps the document that is open on screen "armed" for printing: its pages are
// prepared in a hidden container, so ANY print command (the Print button,
// Ctrl/Cmd+P, the browser's File > Print menu) prints only that document, in its
// current edited state, instead of the whole PDFScanner page around it.
//
// - Re-arms when the document changes (an edit, a new conversion result), a moment
//   after the change settles.
// - Disarms when the document goes away or the screen is left; with nothing open,
//   the browser prints the page as it always did.
// - Ctrl/Cmd+P pressed while the pages are still being prepared waits for them,
//   then prints, so the shortcut can never print the wrong thing.
// - A print made with the browser's own command (not our button) is counted once
//   as a `print` event from source "browser".

import { useEffect, useLayoutEffect, useRef } from "react";
import { trackPrint } from "@/utils/analytics/events";
import { armDocument, releasePages, type ArmHandle, type PrintPage } from "@/utils/print/printPages";

const ARM_DELAY_MS = 300;

// Preparing a long PDF just in case it gets printed would be wasteful, so documents
// longer than this are only printed through the Print button.
export const ARM_MAX_PAGES = 30;

export function useArmedDocument({
  hasDocument,
  active,
  docKey,
  title,
  load,
}: {
  // Is there a document on screen at all?
  hasDocument: boolean;
  // False while the document is changing (e.g. pages still processing): the last
  // prepared version stays armed until the new one is ready.
  active: boolean;
  // Changes whenever the document's content does.
  docKey: unknown;
  title?: string;
  // Produces the pages to print, in their current state.
  load: () => Promise<PrintPage[]>;
}) {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const handleRef = useRef<ArmHandle | null>(null);
  // Set while the armed pages are out of date or being prepared. A layout effect, so
  // it is in place the instant the change is on screen (a passive effect could lag
  // a keystroke behind it).
  const inFlightRef = useRef<Promise<void> | null>(null);

  useLayoutEffect(() => {
    if (!hasDocument) return;
    let cancelled = false;
    let settle!: () => void;
    const inFlight = new Promise<void>((resolve) => (settle = resolve));
    inFlightRef.current = inFlight;
    const finish = () => {
      settle();
      if (inFlightRef.current === inFlight) inFlightRef.current = null;
    };
    // The document is still changing: stay busy until it settles (this effect then re-runs).
    if (!active) return finish;
    const timer = setTimeout(async () => {
      try {
        const pages = await loadRef.current();
        if (cancelled) {
          releasePages(pages);
          return;
        }
        const handle = armDocument(pages, { title, onBrowserPrint: () => void trackPrint("browser", pages.length) });
        handleRef.current = handle;
        await handle.ready;
      } catch {
        // Not armed (too long, unreadable...): the Print button still works.
      } finally {
        finish();
      }
    }, ARM_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      finish();
    };
  }, [hasDocument, active, docKey, title]);

  // No document any more: stop intercepting the browser's print.
  useEffect(() => {
    if (hasDocument) return;
    handleRef.current?.disarm();
    handleRef.current = null;
  }, [hasDocument]);

  // Leaving the screen.
  useEffect(
    () => () => {
      handleRef.current?.disarm();
      handleRef.current = null;
    },
    [],
  );

  // Ctrl/Cmd+P while the document is still being prepared: wait, then print.
  useEffect(() => {
    if (!hasDocument) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((!e.ctrlKey && !e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "p") return;
      if (!inFlightRef.current) return;
      e.preventDefault();
      void (async () => {
        while (inFlightRef.current) await inFlightRef.current;
        window.print();
      })();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasDocument]);
}

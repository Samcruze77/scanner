"use client";

// The one Print button used everywhere a document is open. It asks the caller
// for the pages to print at click time (so the document printed is always the
// one this button belongs to, not whatever else is on screen), then hands them
// to the browser's own print dialog. The person chooses the printer there; this
// app never lists or contacts printers.
//
// Renders a button plus, when something goes wrong, a message on its own line
// (`basis-full`), so it can sit in any of the existing flex-wrap button rows.

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { trackError, trackPrint } from "@/utils/analytics/events";
import { isPrintSupported, PrintError, printPages, type PrintErrorCode, type PrintPage } from "@/utils/print/printPages";

export const PRINT_UNSUPPORTED_MESSAGE = "Printing isn't available in this browser. Download the file and print it from your device.";

const MESSAGES: Record<PrintErrorCode, string> = {
  unsupported: PRINT_UNSUPPORTED_MESSAGE,
  empty: "There's nothing to print yet.",
  too_many_pages: "This document is too long to print from the browser. Download it and print it from your device.",
  password: "That PDF is password-protected. Remove the password first, then print it.",
  render_failed: "Couldn't prepare this document for printing. Download the file and print it from your device.",
};

export function PrintButton({
  getPages,
  source,
  title,
  label = "Print",
  disabled = false,
  className,
}: {
  // Builds the pages to print. Called when the button is pressed.
  getPages: () => Promise<PrintPage[]>;
  // Where this button lives, for analytics only.
  source: "scan" | "editor_page" | "convert" | "compress" | "history";
  // Suggested print job / file name.
  title?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Guards against a second press starting a second job before the first has
  // been handed to the browser (state updates aren't instant).
  const running = useRef(false);

  async function handlePrint() {
    if (running.current) return;
    running.current = true;
    setMessage(null);
    if (!isPrintSupported()) {
      setMessage(PRINT_UNSUPPORTED_MESSAGE);
      void trackError("print", "unsupported");
      running.current = false;
      return;
    }
    setBusy(true);
    try {
      const pages = await getPages();
      await printPages(pages, { title, onPrint: () => void trackPrint(source, pages.length) });
    } catch (error) {
      const code: PrintErrorCode = error instanceof PrintError ? error.code : "render_failed";
      setMessage(MESSAGES[code]);
      void trackError("print", code);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handlePrint()}
        disabled={disabled || busy}
        className={className ?? "btn btn-secondary"}
      >
        <Icon name="print" size={18} />
        {busy ? "Preparing…" : label}
      </button>
      {message && (
        <p role="alert" className="basis-full text-sm text-amber-700 dark:text-amber-400">
          {message}
        </p>
      )}
    </>
  );
}

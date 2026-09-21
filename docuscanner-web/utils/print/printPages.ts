"use client";

// Native printing for whatever document is open. Everything runs on the device:
// nothing is uploaded and no printer is ever discovered or listed here. The
// browser's own print dialog (which the operating system fills with its USB,
// network, AirPrint and print-service printers) does all of that.
//
// How it works: the pages to print are drawn as images inside a print-only
// container that is added to <body>. Screen CSS keeps it invisible; `@media
// print` CSS (app/globals.css) hides everything else in the app and lays the
// container out one page per sheet. Then window.print() is called on the SAME
// document. That is deliberate: printing from a hidden iframe is unreliable on
// iOS Safari and Android, and printing the app's own DOM directly is the one
// approach every browser supports.

export interface PrintPage {
  // data: or blob: URL of the page image. A blob: URL is revoked once printing
  // is finished, so the caller hands ownership over.
  src: string;
  // Pixel size of the image.
  width: number;
  height: number;
  // The page's real size in points (1/72 inch) when it is known, as for a page
  // of a PDF. Such a page prints at its true size, shrunk only if it doesn't fit.
  widthPt?: number;
  heightPt?: number;
}

export type PrintErrorCode = "unsupported" | "empty" | "too_many_pages" | "password" | "render_failed";

export class PrintError extends Error {
  readonly code: PrintErrorCode;
  constructor(code: PrintErrorCode) {
    super(code);
    this.name = "PrintError";
    this.code = code;
  }
}

export const MAX_PRINT_PAGES = 100;

const ROOT_CLASS = "print-root";
// The print job is torn down this long after the browser reports it finished.
// Some mobile browsers report that early, so the images are kept a little
// longer than strictly needed.
const CLEANUP_DELAY_MS = 10_000;

export function isPrintSupported(): boolean {
  return typeof window !== "undefined" && typeof window.print === "function";
}

let active: { teardown: () => void } | null = null;

// Removes any print container left from an earlier job.
export function clearPrintJob(): void {
  active?.teardown();
  active = null;
}

function orientationOf(page: PrintPage): "portrait" | "landscape" {
  const w = page.widthPt ?? page.width;
  const h = page.heightPt ?? page.height;
  return w > h ? "landscape" : "portrait";
}

function waitForImage(img: HTMLImageElement): Promise<void> {
  if (typeof img.decode === "function") return img.decode().catch(() => undefined);
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

export interface PrintOptions {
  // Used as the print job / "Save as PDF" file name, where the browser allows.
  title?: string;
  // Called immediately before the browser's print dialog is requested: the
  // moment printing really starts (used for analytics).
  onPrint?: () => void;
}

// Builds the print container for `pages` and opens the browser's print dialog.
// Resolves once the dialog has been requested. Rejects with a PrintError when
// printing can't be started; the caller shows a message and nothing else breaks.
export async function printPages(pages: PrintPage[], options: PrintOptions = {}): Promise<void> {
  const revoke = () => {
    for (const page of pages) if (page.src.startsWith("blob:")) URL.revokeObjectURL(page.src);
  };
  if (!isPrintSupported()) {
    revoke();
    throw new PrintError("unsupported");
  }
  if (pages.length === 0) throw new PrintError("empty");
  if (pages.length > MAX_PRINT_PAGES) {
    revoke();
    throw new PrintError("too_many_pages");
  }

  clearPrintJob();

  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.setAttribute("aria-hidden", "true");
  root.dataset.first = orientationOf(pages[0]);
  const images: HTMLImageElement[] = [];
  pages.forEach((page, index) => {
    const sheet = document.createElement("section");
    sheet.className = "print-page";
    sheet.dataset.orientation = orientationOf(page);
    if (page.widthPt && page.heightPt) {
      sheet.dataset.sized = "true";
      sheet.style.setProperty("--print-w", `${page.widthPt}pt`);
      sheet.style.setProperty("--print-h", `${page.heightPt}pt`);
    }
    const img = document.createElement("img");
    img.alt = `Page ${index + 1}`;
    img.decoding = "sync";
    img.src = page.src;
    sheet.appendChild(img);
    root.appendChild(sheet);
    images.push(img);
  });
  document.body.appendChild(root);

  const previousTitle = document.title;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let sawPrintMedia = false;
  const media = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;

  const teardown = () => {
    clearTimeout(cleanupTimer);
    window.removeEventListener("afterprint", onAfterPrint);
    media?.removeEventListener?.("change", onMediaChange);
    root.remove();
    revoke();
    document.title = previousTitle;
  };
  const scheduleTeardown = () => {
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(() => {
      if (active?.teardown === teardown) active = null;
      teardown();
    }, CLEANUP_DELAY_MS);
  };
  function onAfterPrint() {
    scheduleTeardown();
  }
  // Browsers that don't fire afterprint still tell us when print media ends.
  function onMediaChange(e: MediaQueryListEvent) {
    if (e.matches) sawPrintMedia = true;
    else if (sawPrintMedia) scheduleTeardown();
  }
  active = { teardown };

  try {
    await Promise.all(images.map(waitForImage));
    if (images.some((img) => !img.complete || img.naturalWidth === 0)) throw new PrintError("render_failed");
  } catch (error) {
    clearPrintJob();
    throw error instanceof PrintError ? error : new PrintError("render_failed");
  }

  window.addEventListener("afterprint", onAfterPrint);
  media?.addEventListener?.("change", onMediaChange);
  if (options.title) document.title = options.title;

  options.onPrint?.();
  try {
    window.print();
  } catch {
    clearPrintJob();
    throw new PrintError("unsupported");
  }
}

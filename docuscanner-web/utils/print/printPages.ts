"use client";

// Native printing for whatever document is open. Everything runs on the device:
// nothing is uploaded and no printer is ever discovered or listed here. The
// browser's own print dialog (which the operating system fills with its USB,
// network, AirPrint and print-service printers) does all of that.
//
// How it works: the pages to print are drawn as images inside a print-only
// container (.print-root) added to <body>. Screen CSS keeps it invisible; `@media
// print` CSS (app/globals.css) then hides everything else in the app and lays the
// container out one page per sheet. The container is printed by calling
// window.print() on the SAME document. That is deliberate: printing from a hidden
// iframe is unreliable on iOS Safari and Android, and printing the app's own DOM
// is the one approach every browser supports.
//
// Two ways a container comes to exist:
//  - ARMED: while a document is open on screen, its pages are kept ready in a
//    hidden container. Then ANY print command (the Print button, Ctrl/Cmd+P, the
//    browser's File > Print menu) prints only that document, never the app around it.
//  - ONE-SHOT: the Print button builds a fresh container for exactly the pages
//    it was asked to print, prints it, and removes it afterwards.
// With no document open there is no container, and the browser prints the page
// as it always did.

export interface PrintPage {
  // data: or blob: URL of the page image. A blob: URL is revoked once the page is
  // no longer needed, so the caller hands ownership over.
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
// While any visible container exists, the app around it is hidden when printing.
const SCOPE_CLASS = "print-document";
// A finished one-shot job is removed this long after the browser reports it done.
// Some mobile browsers report that early, so the images are kept a little longer.
const CLEANUP_DELAY_MS = 10_000;

export function isPrintSupported(): boolean {
  return typeof window !== "undefined" && typeof window.print === "function";
}

// Frees the blob: URLs of pages that will not be printed after all.
export function releasePages(pages: PrintPage[]): void {
  for (const page of pages) if (page.src.startsWith("blob:")) URL.revokeObjectURL(page.src);
}

interface Mounted {
  root: HTMLElement;
  images: HTMLImageElement[];
  pages: PrintPage[];
}

function orientationOf(page: PrintPage): "portrait" | "landscape" {
  const w = page.widthPt ?? page.width;
  const h = page.heightPt ?? page.height;
  return w > h ? "landscape" : "portrait";
}

// The app is only hidden for printing while a visible container exists.
function refreshScope(): void {
  const visible = document.querySelector(`.${ROOT_CLASS}:not([data-suspended])`) !== null;
  document.documentElement.classList.toggle(SCOPE_CLASS, visible);
}

function mount(pages: PrintPage[], standing: boolean): Mounted {
  const root = document.createElement("div");
  root.className = ROOT_CLASS;
  root.setAttribute("aria-hidden", "true");
  if (standing) root.dataset.standing = "true";
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
  refreshScope();
  return { root, images, pages };
}

function unmount(m: Mounted): void {
  m.root.remove();
  releasePages(m.pages);
  refreshScope();
}

function waitForImage(img: HTMLImageElement): Promise<void> {
  if (typeof img.decode === "function") return img.decode().catch(() => undefined);
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

async function imagesReady(m: Mounted): Promise<boolean> {
  await Promise.all(m.images.map(waitForImage));
  return m.images.every((img) => img.complete && img.naturalWidth > 0);
}

// ---- the open ("armed") document --------------------------------------------------------

interface Armed {
  m: Mounted;
  cleanup: () => void;
}
let armed: Armed | null = null;
// The Print button's own job, if one is running.
let job: { m: Mounted; teardown: () => void; finish: () => void } | null = null;

export interface ArmOptions {
  // Used as the print job / "Save as PDF" file name, where the browser allows.
  title?: string;
  // Called when the person prints with the BROWSER's own command (Ctrl/Cmd+P or the
  // menu) rather than our button: for analytics, once per print.
  onBrowserPrint?: () => void;
}

export interface ArmHandle {
  // Resolves true once every page image is decoded and the document is ready to print.
  ready: Promise<boolean>;
  disarm: () => void;
}

function setSuspended(m: Mounted | undefined, suspended: boolean): void {
  if (!m) return;
  if (suspended) m.root.dataset.suspended = "true";
  else delete m.root.dataset.suspended;
  refreshScope();
}

// Keeps `pages` ready as the document on screen. Replaces any document armed earlier.
// From now on the browser's own print command prints only these pages.
export function armDocument(pages: PrintPage[], options: ArmOptions = {}): ArmHandle {
  if (!isPrintSupported() || pages.length === 0 || pages.length > MAX_PRINT_PAGES) {
    releasePages(pages);
    return { ready: Promise.resolve(false), disarm: () => undefined };
  }
  armed?.cleanup();

  const m = mount(pages, true);
  // A running Print-button job stays the visible one until it finishes.
  if (job) setSuspended(m, true);
  else refreshScope();

  let savedTitle: string | null = null;
  let lastNotified = 0;
  function onBeforePrint() {
    // Our own button's job is not a browser-initiated print.
    if (job) return;
    if (options.title) {
      savedTitle = document.title;
      document.title = options.title;
    }
    const now = Date.now();
    // Some browsers fire this more than once for a single print.
    if (now - lastNotified > 3000) {
      lastNotified = now;
      options.onBrowserPrint?.();
    }
  }
  function onAfterPrint() {
    if (savedTitle !== null) {
      document.title = savedTitle;
      savedTitle = null;
    }
  }
  window.addEventListener("beforeprint", onBeforePrint);
  window.addEventListener("afterprint", onAfterPrint);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    window.removeEventListener("beforeprint", onBeforePrint);
    window.removeEventListener("afterprint", onAfterPrint);
    if (savedTitle !== null) document.title = savedTitle;
    if (armed?.m === m) armed = null;
    unmount(m);
  };
  armed = { m, cleanup };

  const ready = imagesReady(m).then((ok) => {
    if (!ok) cleanup();
    return ok;
  });
  return { ready, disarm: cleanup };
}

// ---- the Print button's job ----------------------------------------------------------------

// Removes the Print button's job, if any, and brings the open document back.
export function clearPrintJob(): void {
  job?.teardown();
}

export interface PrintOptions {
  // Used as the print job / "Save as PDF" file name, where the browser allows.
  title?: string;
  // Called immediately before the browser's print dialog is requested: the
  // moment printing really starts (used for analytics).
  onPrint?: () => void;
}

// Builds a container for exactly `pages` and opens the browser's print dialog.
// Resolves once the dialog has been requested. Rejects with a PrintError when
// printing can't be started; the caller shows a message and nothing else breaks.
export async function printPages(pages: PrintPage[], options: PrintOptions = {}): Promise<void> {
  if (!isPrintSupported()) {
    releasePages(pages);
    throw new PrintError("unsupported");
  }
  if (pages.length === 0) throw new PrintError("empty");
  if (pages.length > MAX_PRINT_PAGES) {
    releasePages(pages);
    throw new PrintError("too_many_pages");
  }

  clearPrintJob();

  const m = mount(pages, false);
  // This job is the visible one; the open document waits underneath it.
  setSuspended(armed?.m, true);

  const previousTitle = document.title;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let sawPrintMedia = false;
  let finished = false;
  const media = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;

  const teardown = () => {
    clearTimeout(cleanupTimer);
    window.removeEventListener("afterprint", finish);
    media?.removeEventListener?.("change", onMediaChange);
    if (job?.m === m) job = null;
    unmount(m);
    setSuspended(armed?.m, false);
    document.title = previousTitle;
  };
  // The browser says printing is over: hand the screen back to the open document at
  // once, and remove this job's images shortly after.
  function finish() {
    if (finished) return;
    finished = true;
    setSuspended(m, true);
    setSuspended(armed?.m, false);
    cleanupTimer = setTimeout(teardown, CLEANUP_DELAY_MS);
  }
  // Browsers that don't fire afterprint still tell us when print media ends.
  function onMediaChange(e: MediaQueryListEvent) {
    if (e.matches) sawPrintMedia = true;
    else if (sawPrintMedia) finish();
  }
  job = { m, teardown, finish };

  if (!(await imagesReady(m))) {
    teardown();
    throw new PrintError("render_failed");
  }
  // Replaced by a newer job while the images were decoding.
  if (job?.m !== m) throw new PrintError("render_failed");

  window.addEventListener("afterprint", finish);
  media?.addEventListener?.("change", onMediaChange);
  if (options.title) document.title = options.title;

  options.onPrint?.();
  try {
    window.print();
  } catch {
    teardown();
    throw new PrintError("unsupported");
  }
}

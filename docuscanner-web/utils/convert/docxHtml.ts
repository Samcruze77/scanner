"use client";

// Word (.docx) -> clean, safe HTML, entirely in the browser. mammoth reads the
// document's structure (headings, lists, tables, images, links, bold/italic/
// underline); this module adds paragraph alignment and page breaks, converts
// images to formats the PDF builder can embed, and sanitizes the result.
//
// A .docx is untrusted input, so:
//  - mammoth's `externalFileAccess` is left OFF (its default), so a document
//    that links to a file or URL for an image can't make this read anything
//    outside the uploaded file. Linked (non-embedded) images are skipped.
//  - Everything mammoth produces goes through DOMPurify with a strict
//    allow-list (no scripts, no event handlers, no styles, only http/https/
//    mailto links and embedded PNG/JPEG images) before anything else sees it.
//  - No content or filenames are sent anywhere.

export const MAX_DOCX_BYTES = 15 * 1024 * 1024;
// Embedded pictures beyond these limits are skipped, so a crafted file can't
// balloon the PDF or exhaust memory.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGES = 200;

export type WordErrorCode =
  | "word_unsupported_type"
  | "word_legacy_doc"
  | "word_too_large"
  | "word_invalid"
  | "word_unreadable"
  | "word_empty"
  | "word_failed";

export class WordConvertError extends Error {
  readonly code: WordErrorCode;
  constructor(code: WordErrorCode) {
    super(code);
    this.name = "WordConvertError";
    this.code = code;
  }
}

export interface DocxHtmlResult {
  html: string;
  warnings: string[];
  // Whether the document had any text or pictures at all.
  hasContent: boolean;
}

type MammothModule = typeof import("mammoth");

async function loadMammoth(): Promise<MammothModule> {
  const mod = await import("mammoth");
  // mammoth is CommonJS: the API may be on `.default`.
  return "convertToHtml" in mod ? mod : (mod as unknown as { default: MammothModule }).default;
}

// ---- file checks ---------------------------------------------------------------

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

// Called before parsing anything: right extension, sane size, and the bytes
// really are a zip container (a .docx is one).
export function checkDocxFile(file: File, head: Uint8Array): void {
  const name = file.name.toLowerCase();
  if (name.endsWith(".doc")) throw new WordConvertError("word_legacy_doc");
  if (!name.endsWith(".docx")) throw new WordConvertError("word_unsupported_type");
  if (file.size > MAX_DOCX_BYTES) throw new WordConvertError("word_too_large");
  // Old .doc files, and password-protected documents of any age, are OLE
  // containers rather than zip files.
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) throw new WordConvertError("word_legacy_doc");
  if (!startsWith(head, [0x50, 0x4b, 0x03, 0x04])) throw new WordConvertError("word_invalid");
}

// ---- alignment & style map ------------------------------------------------------

// mammoth reads paragraph alignment but doesn't turn it into HTML. Tag aligned
// paragraphs with a synthetic style name and map that name to a class.
const ALIGN_TOKENS: Record<string, string> = {
  center: "jc-center",
  right: "jc-right",
  end: "jc-right",
  both: "jc-justify",
  distribute: "jc-justify",
};

interface DocumentElement {
  type?: string;
  alignment?: string | null;
  styleName?: string | null;
  numbering?: unknown;
  children?: DocumentElement[];
  [key: string]: unknown;
}

function tagAlignment(element: DocumentElement): DocumentElement {
  const node =
    element.children && Array.isArray(element.children)
      ? { ...element, children: element.children.map(tagAlignment) }
      : element;
  if (node.type !== "paragraph" || node.numbering) return node;
  const token = node.alignment ? ALIGN_TOKENS[node.alignment] : undefined;
  if (!token) return node;
  // "Heading 1" + centre becomes "Heading 1|jc-center"; see STYLE_MAP.
  return { ...node, styleName: node.styleName ? `${node.styleName}|${token}` : token };
}

function buildStyleMap(): string[] {
  // A page break becomes an <hr> marker (an empty <p> would be dropped); it is
  // folded into the following block below.
  // Title/Subtitle aren't in mammoth's defaults, so they'd come out as body text.
  const rules = [
    "u => u",
    "strike => s",
    "br[type='page'] => hr.page-break",
    "p[style-name='Title'] => h1:fresh",
    "p[style-name='Subtitle'] => h2:fresh",
  ];
  for (const [token, cls] of [
    ["jc-center", "jc-center"],
    ["jc-right", "jc-right"],
    ["jc-justify", "jc-justify"],
  ]) {
    rules.push(`p[style-name='${token}'] => p.${cls}:fresh`);
    for (let level = 1; level <= 6; level++) {
      // Both spellings Word writes; kept ahead of mammoth's own heading rules.
      rules.push(`p[style-name='Heading ${level}|${token}'] => h${level}.${cls}:fresh`);
      rules.push(`p[style-name='heading ${level}|${token}'] => h${level}.${cls}:fresh`);
    }
    rules.push(`p[style-name='Title|${token}'] => h1.${cls}:fresh`);
    rules.push(`p[style-name='Subtitle|${token}'] => h2.${cls}:fresh`);
  }
  return rules;
}

// ---- images ---------------------------------------------------------------------

const PDF_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg"]);

// Re-encodes a browser-decodable picture (GIF, BMP, WebP...) as PNG, since the
// PDF builder only embeds PNG and JPEG. Returns null if it can't be decoded.
async function reencodeAsPng(contentType: string, base64: string): Promise<string | null> {
  try {
    const img = new Image();
    img.src = `data:${contentType};base64,${base64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
    ctx.drawImage(img, 0, 0);
    const url = canvas.toDataURL("image/png");
    canvas.width = canvas.height = 0;
    return url;
  } catch {
    return null;
  }
}

// ---- sanitizing -----------------------------------------------------------------

const ALLOWED_TAGS = [
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "sub", "sup", "br", "hr",
  "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "a", "img", "span", "blockquote",
];
const ALLOWED_ATTRIBUTES = ["href", "src", "alt", "colspan", "rowspan", "class", "width", "height"];
// Links: web and email only. Images: embedded PNG/JPEG only -- never a URL, so
// nothing is ever fetched from the network.
const ALLOWED_URIS = /^(?:https?:|mailto:|data:image\/(?:png|jpe?g);base64,)/i;

async function sanitize(html: string): Promise<string> {
  const purify = (await import("dompurify")).default;
  return purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
    ALLOWED_URI_REGEXP: ALLOWED_URIS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
  });
}

// The PDF font covers Latin, Greek and Cyrillic. Text in scripts it lacks would
// print as blanks, so say so instead of failing silently.
const UNSUPPORTED_RANGES: [number, number][] = [
  [0x0590, 0x0dff], // Hebrew, Arabic, Indic scripts
  [0x0e00, 0x0eff], // Thai, Lao
  [0x1100, 0x11ff], // Hangul Jamo
  [0x2e80, 0x9fff], // CJK
  [0xac00, 0xd7af], // Hangul
  [0x1f000, 0x1faff], // Emoji
];

function countUnsupported(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (UNSUPPORTED_RANGES.some(([lo, hi]) => code >= lo && code <= hi)) count++;
  }
  return count;
}

// ---- main -----------------------------------------------------------------------

export async function docxToSafeHtml(buffer: ArrayBuffer): Promise<DocxHtmlResult> {
  const mammoth = await loadMammoth();
  const warnings: string[] = [];

  let imageCount = 0;
  let imageBytes = 0;
  let skippedImages = 0;

  const convertImage = mammoth.images.imgElement(async (image) => {
    const type = image.contentType.toLowerCase();
    const base64 = await image.readAsBase64String();
    const approxBytes = Math.floor(base64.length * 0.75);
    if (imageCount >= MAX_IMAGES || approxBytes > MAX_IMAGE_BYTES || imageBytes + approxBytes > MAX_TOTAL_IMAGE_BYTES) {
      skippedImages++;
      return { src: "" };
    }
    imageCount++;
    imageBytes += approxBytes;

    if (PDF_IMAGE_TYPES.has(type)) return { src: `data:${type === "image/jpg" ? "image/jpeg" : type};base64,${base64}` };
    const png = await reencodeAsPng(type, base64);
    if (png) return { src: png };
    // EMF/WMF and other formats a browser can't draw.
    skippedImages++;
    return { src: "" };
  });

  let raw: string;
  let linkedImages = 0;
  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      {
        styleMap: buildStyleMap(),
        transformDocument: (element: unknown) => tagAlignment(element as DocumentElement),
        convertImage,
        // Explicit, although it is the default: never read files or URLs named
        // inside an untrusted document.
        externalFileAccess: false,
      },
    );
    raw = result.value;
    // Pictures linked from outside the file (a path or URL) can't be read from a
    // browser, and we wouldn't want to. Count them so people are told; the
    // addresses themselves are never shown.
    linkedImages = result.messages.filter((m) => /external image/i.test(m.message)).length;
  } catch {
    throw new WordConvertError("word_unreadable");
  }

  const html = await sanitize(raw);
  const doc = new DOMParser().parseFromString(html, "text/html");
  // Pictures that were skipped (or whose data was rejected) leave an empty tag.
  doc.querySelectorAll("img").forEach((img) => {
    if (!img.getAttribute("src")) {
      img.remove();
      skippedImages++;
    }
  });
  // Turn each page-break marker into a flag on the block that follows it, so
  // the PDF starts that block on a new page without an empty line at the top.
  doc.querySelectorAll("hr.page-break").forEach((marker) => {
    // mammoth writes the marker inside the (otherwise empty) paragraph that held
    // the break, and the HTML parser leaves empty <p> shells around it. Skip
    // those to reach the real next block.
    let anchor: Element = marker;
    const parent = marker.parentElement;
    if (parent && parent !== doc.body && parent.tagName === "P") anchor = parent;
    let next = anchor.nextElementSibling;
    while (next && next.tagName === "P" && (next.textContent ?? "").trim() === "" && !next.querySelector("img")) {
      const shell = next;
      next = next.nextElementSibling;
      shell.remove();
    }
    if (next) next.classList.add("page-break-before");
    anchor.remove();
  });
  const text = doc.body.textContent ?? "";
  const hasContent = text.trim().length > 0 || doc.querySelector("img") !== null;

  skippedImages += linkedImages;
  if (skippedImages > 0) {
    warnings.push(
      `${skippedImages} picture${skippedImages === 1 ? "" : "s"} couldn't be included (unsupported format, linked from outside the file, or too large).`,
    );
  }
  const unsupported = countUnsupported(text);
  if (unsupported > 0) {
    warnings.push(
      "Some characters (for example Chinese, Japanese, Korean, Arabic, Hebrew or emoji) aren't supported in the PDF and may appear blank.",
    );
  }

  return { html: doc.body.innerHTML, warnings, hasContent };
}

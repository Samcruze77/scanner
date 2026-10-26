// Shared helpers for the layout checks: load a document into the real editor without touching the page's code (a saved
// draft in localStorage, with IndexedDB switched off), read back where every line of text and every page boundary is,
// and read the same from a PDF that Microsoft Word exported from the downloaded .docx.
import { extractLines } from "../docx/pdftool.mjs";

export const CONSENT = JSON.stringify({ version: 1, decided_at: new Date().toISOString(), analytics: false, advertising: false, recordings: false });

// The init script that makes the page restore `doc` as the last draft. Runs before the page's own scripts.
export function seedDraft(doc, margins, title = "Layout check") {
  return [
    ({ doc, margins, title, consent }) => {
      try {
        Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
        localStorage.setItem("ds_consent", consent);
        const id = "layout-check";
        localStorage.setItem("fps-wc:draft:" + id, JSON.stringify({ id, title, updatedAt: Date.now(), margins: margins ?? { top: 1440, right: 1440, bottom: 1440, left: 1440 }, content: doc, imageIds: [] }));
        localStorage.setItem("fps-wc:last", id);
      } catch {}
    },
    { doc, margins, title, consent: CONSENT },
  ];
}

// Every line of text in the editor, in order, with the page it is on, read from where the browser actually drew it.
// Tops and lefts are in the page's own (unscaled) CSS pixels, so they do not depend on the display zoom.
export function readEditorLayout(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".wc-page");
    const rr = root.getBoundingClientRect();
    const scale = rr.width / root.offsetWidth || 1;
    const cs = getComputedStyle(root);
    const pageH = parseFloat(cs.getPropertyValue("--wc-h")) || 1123;
    const gap = parseFloat(cs.getPropertyValue("--wc-gap")) || 24;
    const pitch = pageH + gap;
    const skip = '[data-wc-gap], .wc-pagebreak, .ProseMirror-gapcursor, .ProseMirror-trailingBreak, img';
    const chars = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    let blockId = 0;
    const blocks = new Map();
    const blockOf = (n) => {
      let el = n.parentElement;
      while (el && el.parentElement !== root && !/^(P|H1|H2|H3|LI)$/.test(el.tagName)) el = el.parentElement;
      while (el && el.tagName !== "LI" && !/^(P|H1|H2|H3)$/.test(el.tagName)) el = el.parentElement;
      if (!blocks.has(el)) blocks.set(el, ++blockId);
      return blocks.get(el);
    };
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest(skip)) continue;
      const value = node.nodeValue ?? "";
      const block = blockOf(node);
      for (let i = 0; i < value.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (!r || (r.width === 0 && r.height === 0)) continue;
        chars.push({ c: value[i], top: (r.top - rr.top) / scale, bottom: (r.bottom - rr.top) / scale, left: (r.left - rr.left) / scale, right: (r.right - rr.left) / scale, block });
      }
    }
    const lines = [];
    for (const ch of chars) {
      const last = lines[lines.length - 1];
      // a new line when the block changes or the character sits clearly lower than the line's middle
      if (last && last.block === ch.block && ch.top < last.bottom - 2 && ch.bottom > last.top + 2) {
        last.text += ch.c;
        last.right = Math.max(last.right, ch.right);
        last.top = Math.min(last.top, ch.top);
        last.bottom = Math.max(last.bottom, ch.bottom);
      } else {
        lines.push({ text: ch.c, top: ch.top, bottom: ch.bottom, left: ch.left, right: ch.right, block: ch.block });
      }
    }
    const out = lines
      .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ""), page: Math.floor(l.top / pitch) + 1 }))
      .filter((l) => l.text);
    const pageCount = Number(document.querySelector("[data-testid=wc-desk]")?.getAttribute("data-pages")) || Math.max(1, ...out.map((l) => l.page));
    return { lines: out, pageCount, pitch, pageH, scale, rootWidth: root.offsetWidth };
  });
}

// The lines Word drew, from the PDF it exported: { page, text } with spaces removed, list markers dropped.
export async function readWordLayout(pdfFile) {
  const pages = await extractLines(pdfFile);
  const lines = [];
  for (const p of pages) {
    for (const l of p.lines) {
      let text = l.text.replace(/\s+/g, "");
      // list markers (a bullet or "1.") are drawn by CSS in the editor and are text in Word's PDF
      text = text.replace(/^(?:[\u2022\u00b7\uf0b7\uf0a7]|(?:\d+|[a-z]|[ivxlc]+)\.(?=[A-Z]))/, "");
      if (text) lines.push({ page: p.number, text, y: l.y, x: l.x, size: l.size });
    }
  }
  return { lines, pageCount: pages.length };
}

// A short fingerprint of a line's text, so a recorded reference stays small
import { createHash } from "node:crypto";
export const lineKey = (text) => createHash("sha1").update(text).digest("hex").slice(0, 8);

// Compare line by line: the same text on the same line, on the same page.
export function compareLayouts(editor, word) {
  const diffs = [];
  const n = Math.max(editor.lines.length, word.lines.length);
  let sameLines = 0;
  for (let i = 0; i < n; i++) {
    const a = editor.lines[i];
    const b = word.lines[i];
    if (a && b && a.text === b.text && a.page === b.page) sameLines++;
    else if (diffs.length < 6) diffs.push({ index: i, editor: a ? `p${a.page} ${a.text.slice(0, 60)}` : "(none)", word: b ? `p${b.page} ${b.text.slice(0, 60)}` : "(none)" });
  }
  // Vertical positions: for the lines that match, how far each is from where Word put it, measured from the first matching line on its
  // page (points; the editor's pixels are converted). Word's y is a baseline and the editor's top is the top of the text box, so only
  // differences between lines of the same size and font are meaningful: the first line of each page is the reference.
  let maxDrift = 0;
  // with several font sizes on the page the editor's box tops and Word's baselines are not comparable line by line
  const sizes = new Set(word.lines.map((l) => Math.round(l.size * 10)));
  if (sizes.size > 1) maxDrift = NaN;
  const firstOnPage = new Map();
  for (let i = 0; i < Math.min(editor.lines.length, word.lines.length); i++) {
    const a = editor.lines[i];
    const b = word.lines[i];
    if (a.text !== b.text || a.page !== b.page) continue;
    const topPt = ((a.top - (a.page - 1) * editor.pitch) * 72) / 96;
    if (!firstOnPage.has(a.page)) firstOnPage.set(a.page, { e: topPt, w: b.y, size: b.size });
    const ref = firstOnPage.get(a.page);
    if (Math.abs(b.size - ref.size) > 0.01) continue;
    if (!Number.isNaN(maxDrift)) maxDrift = Math.max(maxDrift, Math.abs(topPt - ref.e - (b.y - ref.w)));
  }
  return { maxDrift, editorLines: editor.lines.length, wordLines: word.lines.length, sameLines, editorPages: editor.pageCount, wordPages: word.pageCount, diffs };
}

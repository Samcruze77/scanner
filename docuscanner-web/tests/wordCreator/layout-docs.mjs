// Deterministic documents for the layout checks: the same words every run, so a page break that moves is a real change.
// Used by layout.mjs (editor vs the exported .docx) and by the Word comparison (layout-word.mjs).

const WORDS = (
  "the of and a to in is you that it he was for on are as with his they at be this from have or by one had not but what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words called just where most know get through back much before go good new write our me man too any day same right look think also around another came come work three word must because does part even place well such here take why help put different away again off went old number great tell men say small every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always looked show large often together asked house don't world going want school important until form food keep children feet land side without boy once animal life enough took sometimes four head above kind began almost live page got earth need far hand high year mother light country father let night picture being study second soon story since white ever paper hard near sentence better best across during today however sure knew try told young sun thing whole hear example heard several change answer room sea against top turned learn point city play toward five using himself usually"
).split(" ");

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// `count` words, capitalised at the start of each sentence, with a full stop every 8 to 16 words.
export function words(seed, count) {
  const r = rng(seed);
  const out = [];
  let untilStop = 8 + Math.floor(r() * 9);
  let start = true;
  for (let i = 0; i < count; i++) {
    let w = WORDS[Math.floor(r() * WORDS.length)];
    if (start) w = w[0].toUpperCase() + w.slice(1);
    start = false;
    if (--untilStop === 0 || i === count - 1) {
      w += ".";
      untilStop = 8 + Math.floor(r() * 9);
      start = true;
    }
    out.push(w);
  }
  return out.join(" ");
}

const text = (t, marks) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (t, attrs) => ({ type: "paragraph", ...(attrs ? { attrs } : {}), ...(t ? { content: [text(t)] } : {}) });
const heading = (level, t) => ({ type: "heading", attrs: { level }, content: [text(t)] });
const style = (family, size) => [{ type: "textStyle", attrs: { ...(family ? { fontFamily: family } : {}), ...(size ? { fontSize: size } : {}) } }];
const FAMILY = {
  Arial: 'Arial, "Liberation Sans", Arimo, Helvetica, sans-serif',
  "Times New Roman": '"Times New Roman", "Liberation Serif", Tinos, Times, serif',
  Calibri: 'Calibri, Carlito, "Segoe UI", sans-serif',
};
const doc = (...content) => ({ type: "doc", content });
const pageBreak = () => ({ type: "pageBreak" });
const bullets = (seed, n, each) => ({
  type: "bulletList",
  content: Array.from({ length: n }, (_, i) => ({ type: "listItem", content: [para(words(seed + i, each))] })),
});
const numbered = (seed, n, each) => ({
  type: "orderedList",
  content: Array.from({ length: n }, (_, i) => ({ type: "listItem", content: [para(words(seed + i, each))] })),
});

// Each entry: the document and, optionally, margins in twips. Paragraph attrs follow the editor's own names.
export const LAYOUT_DOCS = [
  { id: "plain-long", note: "default Calibri 11, ordinary paragraphs over several pages", doc: doc(...Array.from({ length: 24 }, (_, i) => para(words(100 + i, 40 + ((i * 17) % 90))))) },
  { id: "headings", note: "headings followed by body text", doc: doc(...Array.from({ length: 10 }, (_, i) => [heading(1 + (i % 3), words(200 + i, 4 + (i % 4))), para(words(300 + i, 90 + i * 9)), para(words(400 + i, 60))]).flat()) },
  { id: "arial-12", note: "Arial 12 with 1.5 line spacing", doc: doc(...Array.from({ length: 16 }, (_, i) => ({ type: "paragraph", attrs: { lineHeight: 1.5 }, content: [text(words(500 + i, 50 + ((i * 13) % 70)), style(FAMILY.Arial, "12pt"))] }))) },
  { id: "times-14-justify", note: "Times New Roman 14, justified, space after 12", doc: doc(...Array.from({ length: 14 }, (_, i) => ({ type: "paragraph", attrs: { textAlign: "justify", spaceAfter: 12 }, content: [text(words(600 + i, 55 + ((i * 11) % 60)), style(FAMILY["Times New Roman"], "14pt"))] }))) },
  { id: "narrow-margins", note: "narrow margins (0.5 in)", margins: { top: 720, right: 720, bottom: 720, left: 720 }, doc: doc(...Array.from({ length: 18 }, (_, i) => para(words(700 + i, 45 + ((i * 19) % 80))))) },
  { id: "wide-margins", note: "wide margins (1 in top and bottom, 2 in sides)", margins: { top: 1440, right: 2880, bottom: 1440, left: 2880 }, doc: doc(...Array.from({ length: 14 }, (_, i) => para(words(800 + i, 45 + ((i * 23) % 80))))) },
  { id: "lists", note: "bulleted and numbered lists with long items", doc: doc(para(words(900, 20)), bullets(910, 12, 38), para(words(930, 30)), numbered(940, 12, 36), para(words(960, 40)), bullets(970, 8, 55)) },
  { id: "manual-breaks", note: "explicit page breaks", doc: doc(para(words(1000, 60)), pageBreak(), para(words(1010, 80)), para(words(1020, 40)), pageBreak(), pageBreak(), para(words(1030, 50))) },
];

// Paragraphs whose last line ends close to the bottom of the page, made by search (see layout-boundary in layout-compare).
export function filler(seed, lines) {
  return para(words(seed, lines * 15));
}

// ---- more scenarios: mixed fonts, indents and alignment, pictures, content at the bottom of a page, long documents ----
import { makePicture } from "./fixtures.mjs";
const png = (w, h, colour) => makePicture("png", w, h, colour).dataUrl;
const run = (t, family, size, marks = []) => text(t, [{ type: "textStyle", attrs: { fontFamily: FAMILY[family], fontSize: size } }, ...marks]);
const mixed = (seed, n) => ({
  type: "paragraph",
  content: [run(words(seed, n), "Calibri", "11pt"), run(" " + words(seed + 1, n / 2), "Arial", "14pt"), run(" " + words(seed + 2, n / 2), "Times New Roman", "9pt", [{ type: "bold" }]), run(" " + words(seed + 3, n / 2), "Calibri", "16pt", [{ type: "italic" }])],
});

LAYOUT_DOCS.push(
  { id: "mixed-fonts", note: "runs in different fonts, sizes, bold and italic inside one paragraph", doc: doc(...Array.from({ length: 10 }, (_, i) => mixed(1100 + i * 7, 30 + i * 4))) },
  {
    id: "indent-align",
    note: "indents, alignment, line spacing 1 / 1.5 / 2, space before and after",
    doc: doc(
      ...[
        { textAlign: "right", spaceAfter: 6 },
        { textAlign: "center", spaceBefore: 18 },
        { indent: 2, spaceAfter: 14 },
        { indentLeft: 36, indentRight: 36, textAlign: "justify" },
        { lineHeight: 2, spaceBefore: 12 },
        { lineHeight: 1, spaceAfter: 0 },
        { indentFirstLine: 36, lineHeight: 1.5 },
        {},
      ].flatMap((attrs, i) => [{ type: "paragraph", attrs, content: [text(words(1200 + i, 60 + i * 6))] }, para(words(1300 + i, 40))]),
    ),
  },
  { id: "pictures", note: "pictures of different sizes and alignments between paragraphs", doc: doc(para(words(1400, 50)), { type: "image", attrs: { src: png(400, 300, "#2060c0"), width: 400, align: "left" } }, para(words(1410, 70)), { type: "image", attrs: { src: png(300, 500, "#c06020"), width: 300, align: "center" } }, para(words(1420, 90)), { type: "image", attrs: { src: png(600, 200, "#20a060"), width: 560, align: "right" } }, para(words(1430, 120)), { type: "image", attrs: { src: png(500, 420, "#a020a0"), width: 480, align: "center" } }, para(words(1440, 80))) },
  { id: "small-and-large", note: "9 pt text with 11 pt paragraph marks, and 28 pt text", doc: doc(...Array.from({ length: 8 }, (_, i) => ({ type: "paragraph", content: [run(words(1500 + i, 70 + i * 9), "Calibri", i % 2 ? "9pt" : "28pt")] }))) },
  {
    id: "nested-lists",
    note: "nested bulleted and numbered lists",
    doc: doc(
      para(words(1600, 24)),
      { type: "bulletList", content: Array.from({ length: 6 }, (_, i) => ({ type: "listItem", content: [para(words(1610 + i, 30)), { type: "orderedList", content: Array.from({ length: 3 }, (_, j) => ({ type: "listItem", content: [para(words(1640 + i * 4 + j, 26))] })) }] })) },
      para(words(1700, 40)),
      { type: "orderedList", content: Array.from({ length: 10 }, (_, i) => ({ type: "listItem", content: [para(words(1710 + i, 34))] })) },
    ),
  },
  { id: "long-document", note: "a long document: 60 paragraphs, headings, a list, a page break", doc: doc(...Array.from({ length: 12 }, (_, i) => [heading(1, words(1800 + i, 3)), para(words(1820 + i, 120)), para(words(1840 + i, 80)), para(words(1860 + i, 140)), ...(i === 5 ? [pageBreak()] : []), ...(i % 4 === 3 ? [bullets(1900 + i, 5, 30)] : [])]).flat()) },
);
// text that ends just before, at and just past the bottom of a page: one-line paragraphs, then a longer one that reaches the end of the page
for (const filler of [26, 27, 28, 29, 30, 31]) {
  LAYOUT_DOCS.push({
    id: `bottom-${filler}`,
    note: `${filler} one-line paragraphs, then a 5-line, a 3-line and a 6-line paragraph (widow and orphan control at the page bottom)`,
    doc: doc(...Array.from({ length: filler }, (_, i) => para(`Line ${i + 1} of the filler`)), para(words(2000 + filler, 66)), para(words(2100 + filler, 40)), para(words(2200 + filler, 80))),
  });
  LAYOUT_DOCS.push({
    id: `heading-bottom-${filler}`,
    note: `${filler} one-line paragraphs, then a heading and a paragraph (a heading stays with the text after it)`,
    doc: doc(...Array.from({ length: filler }, (_, i) => para(`Line ${i + 1} of the filler`)), heading(2, "A heading near the end of the page"), para(words(2300 + filler, 70)), para(words(2400 + filler, 50))),
  });
}

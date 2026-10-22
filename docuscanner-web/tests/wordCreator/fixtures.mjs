// Synthetic documents for the Word creator tests: every kind of content the editor can produce, in the
// exact JSON shape it saves, plus real PNG / JPEG pictures to embed.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCanvas } = require("@napi-rs/canvas");

export function makePicture(kind = "png", w = 320, h = 160, colour = "#8000c0") {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = colour;
  ctx.fillRect(10, 10, w - 20, h - 20);
  ctx.fillStyle = "#ffd000";
  ctx.fillRect(w / 2, 0, w / 2, 24);
  const buf = kind === "jpeg" ? c.toBuffer("image/jpeg", 90) : c.toBuffer("image/png");
  return { buf: new Uint8Array(buf), dataUrl: `data:image/${kind};base64,${Buffer.from(buf).toString("base64")}`, w, h };
}

export const text = (t, marks) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
export const p = (content, attrs) => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  ...(content !== undefined ? { content: Array.isArray(content) ? content : [text(content)] } : {}),
});

// Non-ASCII written as code points so this file stays plain ASCII.
export const UNICODE = ["Caf", 0xe9, " na", 0xef, "ve ", 0x2014, " ", 0x65e5, 0x672c, 0x8a9e, " ", 0x645, 0x631, 0x62d, 0x628, 0x627, " ", 0x1f680, " ", 0x2713]
  .map((x) => (typeof x === "number" ? String.fromCodePoint(x) : x))
  .join("");
export const SPECIAL = `Fish & chips <b>not bold</b> "quoted" 'single' 100% #1 \\ back/slash`;

export function syntheticDocument(png, jpeg) {
  const bold = { type: "bold" };
  return {
    type: "doc",
    content: [
      p("My Report", { variant: "title" }),
      p("A subtitle line", { variant: "subtitle" }),
      { type: "heading", attrs: { level: 1 }, content: [text("Chapter one")] },
      { type: "heading", attrs: { level: 2 }, content: [text("Section 1.1")] },
      { type: "heading", attrs: { level: 3 }, content: [text("Subsection 1.1.1")] },
      p([
        text("Plain, "),
        text("bold", [bold]),
        text(", "),
        text("italic", [{ type: "italic" }]),
        text(", "),
        text("underline", [{ type: "underline" }]),
        text(", "),
        text("strike", [{ type: "strike" }]),
        text(", "),
        text("both", [bold, { type: "italic" }]),
        text(". Water is H"),
        text("2", [{ type: "subscript" }]),
        text("O and E=mc"),
        text("2", [{ type: "superscript" }]),
        text("."),
      ]),
      p([
        text("Styled", [{ type: "textStyle", attrs: { fontFamily: '"Times New Roman", "Liberation Serif", Tinos, Times, serif', fontSize: "18pt", color: "#c00000" } }]),
        text(" and "),
        text("highlighted", [{ type: "highlight", attrs: { color: "#ffff00" } }]),
        text(" and "),
        text("Verdana 9", [{ type: "textStyle", attrs: { fontFamily: "Verdana, Geneva, sans-serif", fontSize: "9pt" } }]),
      ]),
      p("Centered paragraph", { textAlign: "center" }),
      p("Right aligned paragraph", { textAlign: "right" }),
      p("Justified paragraph that is long enough to need more than one line when it is displayed on the page, so justification is visible.", { textAlign: "justify" }),
      p("Spaced paragraph", { lineHeight: 1.5, spaceBefore: 12, spaceAfter: 24, indent: 2 }),
      p([
        text("Visit "),
        text("our site", [{ type: "link", attrs: { href: "https://example.com/path?a=1&b=2" } }]),
        text(" or "),
        text("write to us", [{ type: "link", attrs: { href: "mailto:hi@example.com" } }]),
        text("."),
      ]),
      p([text("Line one"), { type: "hardBreak" }, text("Line two after a break")]),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [p("Bullet A"), { type: "bulletList", content: [{ type: "listItem", content: [p("Nested bullet A1")] }] }] },
          { type: "listItem", content: [p("Bullet B")] },
        ],
      },
      {
        type: "orderedList",
        content: [
          { type: "listItem", content: [p("First"), { type: "orderedList", content: [{ type: "listItem", content: [p("First-a")] }, { type: "listItem", content: [p("First-b")] }] }] },
          { type: "listItem", content: [p("Second")] },
        ],
      },
      p("Between the lists"),
      { type: "orderedList", content: [{ type: "listItem", content: [p("Restarts at one")] }] },
      { type: "horizontalRule" },
      p(UNICODE),
      p(SPECIAL),
      p("Tab\tseparated"),
      { type: "image", attrs: { src: png.dataUrl, alt: "Purple box", width: 240, align: "center" } },
      { type: "image", attrs: { src: jpeg.dataUrl, alt: "", width: 300, align: "right" } },
      p(),
      p("Final paragraph."),
    ],
  };
}

// The text the export must contain, one entry per Word paragraph (horizontal line and pictures are
// paragraphs with no text), in order.
export function expectedParagraphs() {
  return [
    "My Report",
    "A subtitle line",
    "Chapter one",
    "Section 1.1",
    "Subsection 1.1.1",
    "Plain, bold, italic, underline, strike, both. Water is H2O and E=mc2.",
    "Styled and highlighted and Verdana 9",
    "Centered paragraph",
    "Right aligned paragraph",
    "Justified paragraph that is long enough to need more than one line when it is displayed on the page, so justification is visible.",
    "Spaced paragraph",
    "Visit our site or write to us.",
    "Line one\nLine two after a break",
    "Bullet A",
    "Nested bullet A1",
    "Bullet B",
    "First",
    "First-a",
    "First-b",
    "Second",
    "Between the lists",
    "Restarts at one",
    "", // horizontal line
    UNICODE,
    SPECIAL,
    "Tab\tseparated",
    "", // picture 1
    "", // picture 2
    "", // empty paragraph
    "Final paragraph.",
  ];
}

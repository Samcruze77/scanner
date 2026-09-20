// Generates realistic DOCX fixtures for the Word -> PDF fidelity tests. Each
// fixture targets one group of formatting features. Word then opens every file
// (see word-export.ps1) to produce the reference PDF, so the fixtures only need
// to be valid, realistic documents - not tuned to any renderer.
//
// Run: node tests/docx/make-fixtures.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  LeaderType,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  UnderlineType,
  VerticalAlign,
  VerticalMergeType,
  WidthType,
  convertInchesToTwip,
  PageOrientation,
  HighlightColor,
} from "docx";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "fixtures");
fs.mkdirSync(outDir, { recursive: true });

const LOREM = [
  "The quarterly review covered revenue, staffing and the product roadmap. Revenue grew steadily across all three regions, although the northern region trailed expectations because two large renewals slipped into the following quarter.",
  "Operations reported that support response times improved after the new triage process went live. The median first reply is now under forty minutes, and the backlog of open tickets has fallen by almost a third since the start of the year.",
  "Engineering shipped the redesigned onboarding flow, the offline mode for mobile and a long list of smaller fixes. Two incidents affected customers; both were resolved within the agreed window and a full write-up is attached to this document.",
  "Looking ahead, the priorities are unchanged: reduce churn among small accounts, expand the partner programme and finish the migration of the remaining legacy services before the end of the financial year.",
];

async function png(width, height, kind) {
  if (kind === "alpha") {
    // Semi-transparent red disc on a transparent background.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2 - 4}" fill="rgb(200,30,30)" fill-opacity="0.85"/><text x="${width / 2}" y="${height / 2 + 8}" font-size="28" text-anchor="middle" fill="white" font-family="Arial">PNG</text></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e88e5"/><stop offset="1" stop-color="#43a047"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="none" stroke="white" stroke-width="4"/><text x="${width / 2}" y="${height / 2 + 10}" font-size="32" text-anchor="middle" fill="white" font-family="Arial">${width}x${height}</text></svg>`;
  const img = sharp(Buffer.from(svg));
  return kind === "jpg" ? img.jpeg({ quality: 88 }).toBuffer() : img.png().toBuffer();
}

const p = (text, opts = {}) => new Paragraph({ children: [new TextRun(text)], ...opts });
const run = (text, o = {}) => new TextRun({ text, ...o });

async function save(name, doc) {
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(outDir, name + ".docx"), buffer);
  console.log("wrote", name, buffer.length);
}

const defaultStyles = (font = "Calibri", size = 22) => ({
  default: {
    document: { run: { font, size } },
  },
});

// 01 - text formatting: fonts, sizes, styles, colours, alignment.
async function fixtureText() {
  const children = [
    p("Text formatting fixture", { spacing: { after: 240 }, children: [run("Text formatting fixture", { size: 40, bold: true })] }),
    p(LOREM[0]),
    p(LOREM[1], { spacing: { before: 120, after: 120 } }),
    new Paragraph({
      spacing: { after: 160 },
      children: [
        run("Sizes: "),
        run("8 pt ", { size: 16 }),
        run("10 pt ", { size: 20 }),
        run("12 pt ", { size: 24 }),
        run("14 pt ", { size: 28 }),
        run("18 pt ", { size: 36 }),
        run("24 pt", { size: 48 }),
      ],
    }),
    new Paragraph({ children: [run("Arial sample text for the fixture. ", { font: "Arial" })] }),
    new Paragraph({ children: [run("Times New Roman sample text for the fixture. ", { font: "Times New Roman", size: 24 })] }),
    new Paragraph({ children: [run("Courier New sample text for the fixture. ", { font: "Courier New" })] }),
    new Paragraph({ children: [run("Cambria sample text for the fixture. ", { font: "Cambria", size: 26 })] }),
    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [
        run("Bold ", { bold: true }),
        run("italic ", { italics: true }),
        run("bold-italic ", { bold: true, italics: true }),
        run("underline ", { underline: { type: UnderlineType.SINGLE } }),
        run("strike ", { strike: true }),
        run("red ", { color: "C00000" }),
        run("blue ", { color: "1F4E79" }),
        run("highlighted ", { highlight: HighlightColor.YELLOW }),
        run("X"),
        run("2", { superScript: true }),
        run(" H"),
        run("2", { subScript: true }),
        run("O ALLCAPS ", { allCaps: true }),
        run("SmallCaps", { smallCaps: true }),
      ],
    }),
    new Paragraph({ alignment: AlignmentType.LEFT, children: [run("Left aligned. " + LOREM[2])] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: [run("Centered. " + LOREM[3])] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 120 }, children: [run("Right aligned. " + LOREM[1])] }),
    new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { before: 120 }, children: [run("Justified. " + LOREM[0] + " " + LOREM[2])] }),
    new Paragraph({
      spacing: { before: 200 },
      children: [
        run("A link: "),
        new ExternalHyperlink({ link: "https://example.com/report", children: [run("https://example.com/report", { style: "Hyperlink", color: "0563C1", underline: { type: UnderlineType.SINGLE } })] }),
      ],
    }),
  ];
  await save("01-text", new Document({ styles: defaultStyles(), sections: [{ children }] }));
}

// 02 - headings and lists.
async function fixtureLists() {
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [run("Project plan")] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run("1. Overview")] }),
    p(LOREM[0]),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run("Goals")] }),
    new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [run("Reduce onboarding time")] }),
    new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [run("Improve retention for small accounts")] }),
    new Paragraph({ numbering: { reference: "bullets", level: 1 }, children: [run("Nested point one")] }),
    new Paragraph({ numbering: { reference: "bullets", level: 1 }, children: [run("Nested point two")] }),
    new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [run("Ship the mobile offline mode with a somewhat longer line so that it has to wrap onto a second line to show the hanging indent working correctly.")] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [run("Steps")] }),
    new Paragraph({ numbering: { reference: "steps", level: 0 }, children: [run("Collect the requirements")] }),
    new Paragraph({ numbering: { reference: "steps", level: 0 }, children: [run("Draft the design")] }),
    new Paragraph({ numbering: { reference: "steps", level: 1 }, children: [run("Review with stakeholders")] }),
    new Paragraph({ numbering: { reference: "steps", level: 1 }, children: [run("Revise")] }),
    new Paragraph({ numbering: { reference: "steps", level: 0 }, children: [run("Build and test, then release to a small group before the full launch so that any problems are found early.")] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run("2. Details")] }),
    p(LOREM[1]),
    new Paragraph({ heading: HeadingLevel.HEADING_3, children: [run("Third level heading")] }),
    p(LOREM[2]),
    new Paragraph({ numbering: { reference: "letters", level: 0 }, children: [run("Lettered item")] }),
    new Paragraph({ numbering: { reference: "letters", level: 0 }, children: [run("Another lettered item")] }),
  ];
  const levels = (fmts) =>
    fmts.map((format, level) => ({
      level,
      format: format.f,
      text: format.t,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: convertInchesToTwip(0.5 * (level + 1)), hanging: convertInchesToTwip(0.25) } } },
    }));
  await save(
    "02-lists",
    new Document({
      styles: defaultStyles(),
      numbering: {
        config: [
          { reference: "bullets", levels: levels([{ f: LevelFormat.BULLET, t: "•" }, { f: LevelFormat.BULLET, t: "o" }]) },
          { reference: "steps", levels: levels([{ f: LevelFormat.DECIMAL, t: "%1." }, { f: LevelFormat.LOWER_LETTER, t: "%2)" }]) },
          { reference: "letters", levels: levels([{ f: LevelFormat.UPPER_LETTER, t: "%1." }]) },
        ],
      },
      sections: [{ children }],
    }),
  );
}

// 03 - spacing, blank lines, indentation.
async function fixtureSpacing() {
  const line = (label, spacing, extra = {}) =>
    new Paragraph({ spacing, ...extra, children: [run(label + " " + LOREM[1] + " " + LOREM[3])] });
  const children = [
    new Paragraph({ children: [run("Spacing and indentation", { bold: true, size: 32 })], spacing: { after: 200 } }),
    line("[single]", { line: 240, lineRule: LineRuleType.AUTO }),
    line("[1.5 lines]", { line: 360, lineRule: LineRuleType.AUTO, before: 120 }),
    line("[double]", { line: 480, lineRule: LineRuleType.AUTO, before: 120 }),
    line("[exactly 20pt]", { line: 400, lineRule: LineRuleType.EXACT, before: 120 }),
    line("[at least 24pt]", { line: 480, lineRule: LineRuleType.AT_LEAST, before: 120 }),
    p("Before blank lines."),
    new Paragraph({ children: [] }),
    new Paragraph({ children: [] }),
    p("After two blank lines."),
    new Paragraph({ spacing: { before: 400, after: 400 }, children: [run("Paragraph with 20pt before and after.")] }),
    p("Next paragraph directly after."),
    new Paragraph({ indent: { left: convertInchesToTwip(0.5) }, spacing: { before: 120 }, children: [run("Left indent 0.5in. " + LOREM[0])] }),
    new Paragraph({ indent: { left: convertInchesToTwip(0.5), right: convertInchesToTwip(0.75) }, spacing: { before: 120 }, children: [run("Left 0.5in, right 0.75in. " + LOREM[0])] }),
    new Paragraph({ indent: { firstLine: convertInchesToTwip(0.5) }, spacing: { before: 120 }, children: [run("First-line indent 0.5in. " + LOREM[2])] }),
    new Paragraph({ indent: { left: convertInchesToTwip(1), hanging: convertInchesToTwip(0.5) }, spacing: { before: 120 }, children: [run("Hanging indent 0.5in at 1in. " + LOREM[2])] }),
    new Paragraph({
      spacing: { before: 200 },
      tabStops: [
        { type: TabStopType.LEFT, position: convertInchesToTwip(2) },
        { type: TabStopType.RIGHT, position: convertInchesToTwip(6), leader: LeaderType.DOT },
      ],
      children: [run("Item"), run("\tDescription"), run("\t$12.50")],
    }),
  ];
  await save("03-spacing", new Document({ styles: defaultStyles(), sections: [{ children }] }));
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const cell = (text, o = {}) =>
  new TableCell({ children: [new Paragraph({ children: [run(text, o.run ?? {})], alignment: o.align })], ...o.cell });

// 04 - tables.
async function fixtureTables() {
  const header = (t) => cell(t, { run: { bold: true, color: "FFFFFF" }, cell: { shading: { type: ShadingType.CLEAR, fill: "1F4E79" } } });
  const rows = [
    new TableRow({ tableHeader: true, children: ["Region", "Q1", "Q2", "Q3"].map(header) }),
    ...["North", "South", "East", "West"].map(
      (r, i) => new TableRow({ children: [cell(r), cell(String(120 + i * 15), { align: AlignmentType.RIGHT }), cell(String(130 + i * 12), { align: AlignmentType.RIGHT }), cell(String(140 + i * 9), { align: AlignmentType.RIGHT })] }),
    ),
  ];
  const wide = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [3000, 2000, 2000, 2360],
    borders: { ...allBorders, insideHorizontal: cellBorder, insideVertical: cellBorder },
    rows,
  });
  const merged = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2340, 2340, 2340, 2340],
    borders: { top: { style: BorderStyle.DOUBLE, size: 6, color: "000000" }, bottom: { style: BorderStyle.DOUBLE, size: 6, color: "000000" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideHorizontal: { style: BorderStyle.DASHED, size: 4, color: "999999" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
    rows: [
      new TableRow({ children: [new TableCell({ columnSpan: 2, children: [p("Spans two columns", { alignment: AlignmentType.CENTER })], shading: { type: ShadingType.CLEAR, fill: "DDEBF7" } }), cell("C3"), cell("C4")] }),
      new TableRow({ children: [new TableCell({ verticalMerge: VerticalMergeType.RESTART, children: [p("Merged down")], verticalAlign: VerticalAlign.CENTER }), cell("B2"), cell("C2"), cell("D2")] }),
      new TableRow({ children: [new TableCell({ verticalMerge: VerticalMergeType.CONTINUE, children: [p("")] }), cell("B3"), cell("C3b"), cell("D3")] }),
      new TableRow({ height: { value: 900, rule: HeightRule.ATLEAST }, children: [cell("Tall row"), cell("x", { cell: { verticalAlign: VerticalAlign.BOTTOM } }), cell("y", { cell: { verticalAlign: VerticalAlign.CENTER } }), cell("z")] }),
    ],
  });
  const longRows = [new TableRow({ tableHeader: true, children: ["#", "Item", "Notes"].map(header) })];
  for (let i = 1; i <= 46; i++) {
    longRows.push(new TableRow({ children: [cell(String(i)), cell("Line item " + i), cell(i % 5 === 0 ? LOREM[3].slice(0, 120) : "Standard note")] }));
  }
  const long = new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [900, 3000, 5460],
    borders: { ...allBorders, insideHorizontal: cellBorder, insideVertical: cellBorder },
    rows: longRows,
  });
  const children = [
    new Paragraph({ children: [run("Tables", { bold: true, size: 32 })], spacing: { after: 160 } }),
    p("A simple grid with a shaded, repeating header row:"),
    wide,
    p("", {}),
    p("Merged cells, double outer border, dashed inner lines and a tall row:"),
    merged,
    new Paragraph({ children: [PageBreakRun()] }),
    p("A long table that runs over the page (header row repeats):"),
    long,
    p("After the table."),
  ];
  await save("04-tables", new Document({ styles: defaultStyles(), sections: [{ children }] }));
}

function PageBreakRun() {
  return new PageBreak();
}

// 05 - images.
async function fixtureImages() {
  const big = await png(640, 360, "png");
  const jpg = await png(400, 300, "jpg");
  const alpha = await png(220, 220, "alpha");
  const children = [
    new Paragraph({ children: [run("Pictures", { bold: true, size: 32 })], spacing: { after: 160 } }),
    p("A wide PNG at 4 inches wide, centred:"),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: big, transformation: { width: 384, height: 216 } })] }),
    p("A JPEG at 3 x 2.25 inches, left aligned, with text after it in the same paragraph:"),
    new Paragraph({ children: [new ImageRun({ type: "jpg", data: jpg, transformation: { width: 288, height: 216 } }), run("  caption text after the picture")] }),
    p("A transparent PNG (disc) sitting inline in text:"),
    new Paragraph({ children: [run("Before "), new ImageRun({ type: "png", data: alpha, transformation: { width: 96, height: 96 } }), run(" after the picture.")] }),
    p("A picture inside a table cell:"),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4680, 4680],
      borders: { ...allBorders, insideHorizontal: cellBorder, insideVertical: cellBorder },
      rows: [new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ children: [new ImageRun({ type: "png", data: big, transformation: { width: 200, height: 112 } })] })] }),
        cell("The picture on the left is 200 px wide."),
      ] })],
    }),
  ];
  await save("05-images", new Document({ styles: defaultStyles(), sections: [{ children }] }));
}

// 06 - page layout: margins, page breaks, headers/footers, page numbers,
// several sections (portrait + landscape) and a two-column section.
async function fixturePages() {
  const body = (n) => Array.from({ length: n }, (_, i) => p(`Paragraph ${i + 1}. ${LOREM[i % LOREM.length]}`, { spacing: { after: 160 } }));
  const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run("Acme Corp - Confidential", { size: 18, color: "666666" })] })] });
  const footer = new Footer({
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [run("Page ", { size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 }), run(" of ", { size: 18 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18 })] }),
    ],
  });
  const letterMargins = { top: convertInchesToTwip(1.25), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.25), right: convertInchesToTwip(1.25) };
  await save(
    "06-pages",
    new Document({
      styles: defaultStyles("Times New Roman", 24),
      sections: [
        {
          properties: { page: { size: { width: 12240, height: 15840 }, margin: { ...letterMargins, header: 720, footer: 720 } } },
          headers: { default: header },
          footers: { default: footer },
          children: [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run("Annual report")] }),
            ...body(9),
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run("After an explicit page break")] }),
            ...body(3),
          ],
        },
        {
          properties: { type: SectionType.NEXT_PAGE, page: { size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080, header: 500, footer: 500 } } },
          headers: { default: header },
          footers: { default: footer },
          children: [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run("Landscape section")] }), ...body(3)],
        },
        {
          properties: { type: SectionType.NEXT_PAGE, column: { count: 2, space: 480 }, page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
          headers: { default: header },
          footers: { default: footer },
          children: [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run("Two columns (A4)")] }), ...body(6)],
        },
      ],
    }),
  );
}

// 07 - a realistic one-page letter / CV style document.
async function fixtureLetter() {
  const rule = { bottom: { style: BorderStyle.SINGLE, size: 8, color: "1F4E79", space: 1 } };
  const children = [
    new Paragraph({ children: [run("Jordan Smith", { bold: true, size: 48, color: "1F4E79" })], spacing: { after: 40 } }),
    new Paragraph({ children: [run("Product Manager | jordan.smith@example.com | +1 555 0100", { size: 20, color: "595959" })], border: rule, spacing: { after: 200 } }),
    new Paragraph({ children: [run("EXPERIENCE", { bold: true, size: 24 })], spacing: { before: 200, after: 80 }, border: rule }),
    new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9360 }], children: [run("Senior Product Manager, Northwind", { bold: true }), run("\t2021 - present")] }),
    new Paragraph({ numbering: { reference: "b", level: 0 }, children: [run("Led the redesign of the onboarding flow, cutting time-to-value by 35%.")] }),
    new Paragraph({ numbering: { reference: "b", level: 0 }, children: [run("Managed a roadmap of twelve initiatives across four squads.")] }),
    new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9360 }], spacing: { before: 160 }, children: [run("Product Manager, Contoso", { bold: true }), run("\t2017 - 2021")] }),
    new Paragraph({ numbering: { reference: "b", level: 0 }, children: [run("Launched the partner programme, generating 18% of new revenue in year one.")] }),
    new Paragraph({ children: [run("EDUCATION", { bold: true, size: 24 })], spacing: { before: 240, after: 80 }, border: rule }),
    new Paragraph({ children: [run("BSc Computer Science", { italics: true }), run(", University of Somewhere, 2016")] }),
    new Paragraph({ children: [run("SKILLS", { bold: true, size: 24 })], spacing: { before: 240, after: 80 }, border: rule }),
    new Paragraph({ spacing: { line: 300, lineRule: LineRuleType.AUTO }, alignment: AlignmentType.JUSTIFIED, children: [run(LOREM[0] + " " + LOREM[3])] }),
  ];
  await save(
    "07-letter",
    new Document({
      styles: defaultStyles("Calibri", 22),
      numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] }] },
      sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1200, right: 1200 } } }, children }],
    }),
  );
}

// 08 - how space-after and space-before combine, paragraph borders, keep-with-next.
async function fixtureRules() {
  const sp = (label, before, after) => new Paragraph({ spacing: { before, after }, children: [run(label)] });
  const children = [
    sp("A1 after 10pt", 0, 200),
    sp("B1 before 10pt", 200, 0),
    sp("A2 after 12pt", 0, 240),
    sp("B2 before 6pt", 120, 0),
    sp("A3 after 0", 0, 0),
    sp("B3 before 12pt", 240, 0),
    sp("A4 after 6pt before 6pt", 120, 120),
    sp("B4 after 6pt before 6pt", 120, 120),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "000000", space: 1 } }, children: [run("Bordered bottom")] }),
    p("After bordered"),
    new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 12, color: "000000", space: 4 }, bottom: { style: BorderStyle.SINGLE, size: 12, color: "000000", space: 4 } }, children: [run("Top and bottom border 1.5pt space 4")] }),
    p("After box"),
    new Paragraph({ shading: { type: ShadingType.CLEAR, fill: "FFF2CC" }, spacing: { before: 120, after: 120 }, children: [run("Shaded paragraph")] }),
    p("After shaded"),
    new Paragraph({ spacing: { line: 240, lineRule: LineRuleType.EXACT }, children: [run("Exactly 12pt line with 11pt text (tight)")] }),
    new Paragraph({ spacing: { line: 300, lineRule: LineRuleType.EXACT }, children: [run("Exactly 15pt", { size: 40 }), run(" with a 20pt run (clipped)")] }),
    new Paragraph({ spacing: { line: 480, lineRule: LineRuleType.AUTO }, children: [run("Double spaced with a big run ", {}), run("BIG", { size: 48 })] }),
    new Paragraph({ children: [run("Arial 11: ", { font: "Arial" }), run("Arial 16 ", { font: "Arial", size: 32 })] }),
    new Paragraph({ children: [run("Times 11: ", { font: "Times New Roman" })] }),
    new Paragraph({ children: [run("Courier 11: ", { font: "Courier New" })] }),
    new Paragraph({ children: [run("Cambria 11: ", { font: "Cambria" })] }),
    new Paragraph({ children: [run("Sup"), run("erscript", { superScript: true }), run(" sub"), run("script", { subScript: true }), run(" line")] }),
  ];
  await save("08-rules", new Document({ styles: defaultStyles(), sections: [{ children }] }));
}

await fixtureText();
await fixtureLists();
await fixtureSpacing();
await fixtureTables();
await fixtureImages();
await fixturePages();
await fixtureLetter();
await fixtureRules();

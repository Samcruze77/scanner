// Multi-page fixtures whose page ends fall in awkward places: many paragraphs of
// varying length, so almost every page break splits a paragraph (widow/orphan
// control decides where), plus keep-with-next headings, a table with a repeating
// header row that crosses a page, a manual page break, a page-break-before
// heading, a list, and a header and footer with page numbers.
//
// Two variants, both compared against Microsoft Word's own PDF (see
// word-export.ps1) by `node tests/docx/compare.mjs`:
//   boundary-calibri  Calibri body / Cambria headings: bundled look-alike fonts,
//                     runs anywhere.
//   boundary-verdana  Verdana body / Georgia headings: fonts with no look-alike,
//                     so it is laid out with the real font files. Those are read
//                     from C:/Windows/Fonts (see boundary-verdana.fonts.json) and
//                     the comparison is skipped where they aren't installed.
//                     Aptos behaves the same way: rerun with
//                       node tests/docx/make-boundary-fixtures.mjs aptos
//                     on a machine that has it and list its files in
//                     boundary-aptos.fonts.json.
//
// Run: node tests/docx/make-boundary-fixtures.mjs [variant...]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "fixtures", "boundaries");
fs.mkdirSync(outDir, { recursive: true });

const VARIANTS = {
  calibri: { body: "Calibri", heading: "Cambria" },
  verdana: { body: "Verdana", heading: "Georgia" },
  aptos: { body: "Aptos", heading: "Aptos Display" },
};

const SENTENCES = [
  "Revenue grew steadily across all three regions, although the northern region trailed expectations because two large renewals slipped into the following quarter.",
  "Support response times improved after the new triage process went live.",
  "The median first reply is now under forty minutes, and the backlog of open tickets has fallen by almost a third since the start of the year.",
  "Engineering shipped the redesigned onboarding flow, the offline mode for mobile and a long list of smaller fixes.",
  "Two incidents affected customers; both were resolved within the agreed window and a full write-up is attached.",
  "Looking ahead, the priorities are unchanged.",
  "Reduce churn among small accounts, expand the partner programme and finish the migration of the remaining legacy services before the end of the financial year.",
  "Hiring is on plan, with eleven of fourteen roles filled and the remainder in final interviews.",
  "Costs were within two percent of budget, helped by lower cloud spending after the storage clean-up.",
  "A detailed breakdown by team, region and product line follows in the appendix, together with the assumptions behind each forecast.",
  "Customer satisfaction held at 4.6 out of 5 for the third consecutive quarter, with onboarding the most improved area.",
  "The board asked for a clearer view of pipeline coverage, so the next report will include weighted and unweighted figures side by side.",
  "Security completed the annual penetration test with no critical findings and three medium ones, all already scheduled for remediation.",
  "Partner-sourced revenue reached its highest share yet, driven by the two new reseller agreements signed in March.",
];

// Small deterministic generator so the fixture is identical on every run.
let seed = 20260926;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const pick = (n) => Math.floor(rand() * n);

function paragraphText() {
  const count = 1 + pick(6);
  return Array.from({ length: count }, () => SENTENCES[pick(SENTENCES.length)]).join(" ");
}

function build(fonts) {
  seed = 20260926;
  const body = (text, o = {}) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 160, line: 259 }, ...o });
  const heading = (text, o = {}) =>
    new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, keepLines: true, children: [new TextRun(text)], ...o });

  const children = [
    new Paragraph({
      children: [new TextRun({ text: "Quarterly Operations Review", font: fonts.heading, size: 44, bold: true })],
      spacing: { after: 240 },
    }),
  ];

  for (let section = 1; section <= 9; section++) {
    children.push(heading(`${section}. ${["Overview", "Revenue", "Operations", "Engineering", "Hiring", "Risks", "Customers", "Outlook", "Appendix"][section - 1]}`, section === 6 ? { pageBreakBefore: true } : {}));
    const paragraphs = 3 + pick(4);
    for (let i = 0; i < paragraphs; i++) children.push(body(paragraphText()));

    if (section === 3) {
      // A list, then a manual page break in the middle of the flow.
      for (let i = 0; i < 5; i++) {
        children.push(new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 60, line: 259 }, children: [new TextRun(SENTENCES[pick(SENTENCES.length)])] }));
      }
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(body("Content after a manual page break: it starts a fresh page. " + paragraphText()));
    }

    if (section === 4) {
      // A table that crosses a page boundary, header row repeating.
      const cell = (text, w, o = {}) =>
        new TableCell({ width: { size: w, type: WidthType.DXA }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, ...o, children: [new Paragraph({ children: [new TextRun({ text, ...(o.run ?? {}) })] })] });
      const widths = [900, 3600, 4860];
      const rows = [
        new TableRow({
          tableHeader: true,
          children: ["#", "Item", "Notes"].map((t, i) => cell(t, widths[i], { shading: { type: ShadingType.CLEAR, fill: "D9E2F3" }, run: { bold: true } })),
        }),
      ];
      for (let r = 1; r <= 22; r++) {
        rows.push(new TableRow({ children: [cell(String(r), widths[0]), cell(SENTENCES[pick(SENTENCES.length)].split(",")[0], widths[1]), cell(paragraphText().slice(0, 60 + pick(200)), widths[2])] }));
      }
      children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: widths, rows }));
      children.push(body("Text straight after the table.", { spacing: { before: 200, after: 160 } }));
    }
  }

  const header = new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 4 } },
        children: [new TextRun({ text: "Acme Corp", size: 18 }), new TextRun({ text: "\tConfidential", size: 18, color: "666666" })],
      }),
    ],
  });
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 18 })],
      }),
    ],
  });

  return new Document({
    styles: {
      default: { document: { run: { font: fonts.body, size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: fonts.heading, size: 30, bold: true, color: "1F3864" }, paragraph: { spacing: { before: 320, after: 120 } } },
      ],
    },
    numbering: { config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440, header: 720, footer: 720 } } }, headers: { default: header }, footers: { default: footer }, children }],
  });
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ["calibri", "verdana"];
for (const name of wanted) {
  const fonts = VARIANTS[name];
  if (!fonts) throw new Error(`unknown variant ${name}`);
  const buffer = await Packer.toBuffer(build(fonts));
  fs.writeFileSync(path.join(outDir, `boundary-${name}.docx`), buffer);
  console.log("wrote", `boundary-${name}.docx`, buffer.length);
}

// Unit tests for the dependency-free table-reconstruction geometry in
// utils/convert/tableExtract.ts. No PDF.js/browser needed -- PositionedText
// fixtures are built by hand to reproduce specific real-world table shapes,
// matching exactly what PDF.js's getTextContent() would report.
//
// Run: node tests/pdf2excel/geometry.mjs

import { extractTable, findColumnBands, groupIntoLines, splitIntoCells } from "../../utils/convert/tableExtract.ts";

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

// A single text run. x/y in PDF units (y grows upward), height ~ font size.
function item(str, x, y, width, height = 10) {
  return { str, x, y, width, height };
}

// ---------------------------------------------------------------------------
// 1. Baseline: a fully-populated 3-column table, every row has all 3 cells.
// ---------------------------------------------------------------------------
{
  console.log("1. Baseline fully-populated table");
  const items = [
    item("Product", 50, 700, 60), item("Qty", 200, 700, 25), item("Price", 300, 700, 35),
    item("Widget", 50, 685, 55), item("12", 200, 685, 15), item("9.99", 300, 685, 30),
    item("Gadget", 50, 670, 55), item("4", 200, 670, 10), item("19.50", 300, 670, 35),
  ];
  const rows = extractTable(items, 600);
  check("3 rows", rows.length === 3, JSON.stringify(rows));
  check("header row has 3 cells", rows[0].length === 3, JSON.stringify(rows[0]));
  check("header text", rows[0][0] === "Product" && rows[0][1] === "Qty" && rows[0][2] === "Price", JSON.stringify(rows[0]));
  check("data row 1", rows[1][0] === "Widget" && rows[1][1] === "12" && rows[1][2] === "9.99", JSON.stringify(rows[1]));
  check("data row 2", rows[2][0] === "Gadget" && rows[2][1] === "4" && rows[2][2] === "19.50", JSON.stringify(rows[2]));
}

// ---------------------------------------------------------------------------
// 2. Sparse/optional column (bug B): a "Notes" column that's blank in every
// row except one -- no single row ever shows the true 4-column count via a
// populated cell in every column, since blank cells simply don't emit a text
// item at all (PDF.js never reports an item for empty space).
// ---------------------------------------------------------------------------
{
  console.log("2. Sparse optional column (bug B regression)");
  // Columns at x=50 (name), x=200 (qty), x=300 (price), x=450 (notes).
  // Every row leaves out exactly one cell, so no row's cell count reaches 4,
  // but across all rows, 4 distinct column positions are used.
  const items = [
    item("Item", 50, 700, 30), item("Qty", 200, 700, 25), item("Price", 300, 700, 35), item("Notes", 450, 700, 40),
    // row 1: notes blank
    item("Widget", 50, 685, 55), item("12", 200, 685, 15), item("9.99", 300, 685, 30),
    // row 2: price blank
    item("Gadget", 50, 670, 55), item("4", 200, 670, 10), item("low stock", 450, 670, 60),
    // row 3: qty blank
    item("Sprocket", 50, 655, 60), item("29.00", 300, 655, 35), item("backordered", 450, 655, 70),
  ];
  const lines = groupIntoLines(items).map(splitIntoCells);
  const bands = findColumnBands(lines, 600);
  check("4 column bands recovered despite no fully-populated row", bands.length === 4, `got ${bands.length} bands: ${JSON.stringify(bands)}`);

  const rows = extractTable(items, 600);
  check("row 1 keeps price/qty separate from notes", rows[1].length >= 3 && rows[1][3] !== rows[1][2], JSON.stringify(rows[1]));
}

// ---------------------------------------------------------------------------
// 3. A genuinely spanning header cell should not inflate the effective
// column count -- capping/merging must still only ever reduce spurious
// over-splitting, never merge columns that data rows clearly populate
// independently.
// ---------------------------------------------------------------------------
{
  console.log("3. Spanning header does not force-merge real data columns");
  const items = [
    // Header: one wide cell spanning what are 2 real data columns below it.
    item("Category (Type / Subtype)", 200, 700, 180),
    item("Price", 450, 700, 35),
    // Data rows: Type and Subtype are genuinely separate, narrow columns.
    item("Fruit", 200, 685, 35), item("Apple", 330, 685, 40), item("1.20", 450, 685, 30),
    item("Veg", 200, 670, 25), item("Carrot", 330, 670, 45), item("0.80", 450, 670, 30),
  ];
  const lines = groupIntoLines(items).map(splitIntoCells);
  const bands = findColumnBands(lines, 600);
  check("Type and Subtype stay distinct columns (>=3 bands)", bands.length >= 3, `got ${bands.length} bands: ${JSON.stringify(bands)}`);
}

// ---------------------------------------------------------------------------
// 4. Tightly-kerned numeric table (bug D): a realistic tight column gap for a
// compactly-typeset financial table (~0.5em -- common real-world padding),
// which the original 0.9em CELL_GAP_EM threshold would fuse into one cell.
// ---------------------------------------------------------------------------
{
  console.log("4. Tightly-kerned numeric columns (realistic ~0.5em gaps)");
  // Font height 10 -> a 5-unit gap (0.5em) between columns, digits within a
  // single number touch (0-unit internal gaps via one text run each).
  const items = [
    item("1,234.50", 100, 700, 45, 10), item("2,000.00", 150, 700, 45, 10), item("3,500.75", 200, 700, 45, 10),
  ];
  const line = splitIntoCells(items);
  check("three separate numeric cells, not fused into one", line.cells.length === 3, JSON.stringify(line.cells));
}

// ---------------------------------------------------------------------------
// 5. Blank-row detection still works with the sparse-column fix in place.
// ---------------------------------------------------------------------------
{
  console.log("5. Blank row between table sections");
  const items = [
    item("A", 50, 700, 10), item("1", 200, 700, 10),
    // big vertical gap
    item("B", 50, 640, 10), item("2", 200, 640, 10),
  ];
  const rows = extractTable(items, 600);
  check("blank row inserted", rows.length === 3 && rows[1].length === 0, JSON.stringify(rows));
}

// ---------------------------------------------------------------------------
// 6. Regression guard: lowering CELL_GAP_EM (bug D fix) must not fracture
// ordinary multi-word cell content -- a normal inter-word space (~0.25-0.3em
// for most proportional fonts) is well under the new 0.4em threshold and
// must still read as one cell, not two.
// ---------------------------------------------------------------------------
{
  console.log("6. Ordinary two-word cell stays one cell (no over-split regression)");
  // height 10 -> normal word-space gap ~2.5 units (0.25em), well under 0.4em.
  const items = [item("New", 50, 700, 25, 10), item("York", 77.5, 700, 30, 10)];
  const line = splitIntoCells(items);
  check("stays one cell", line.cells.length === 1 && line.cells[0].text === "New York", JSON.stringify(line.cells));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

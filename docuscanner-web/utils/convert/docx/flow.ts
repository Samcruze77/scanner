// Block-level layout: tables, and the stacking of paragraphs and tables into
// flows (a table cell, a header, the page body). Pagination lives in paginate.ts.

import { layoutParagraph, textWidth, type Cmd, type LaidParagraph, type LayoutEnv } from "./layout.ts";
import type { Block, Cell, Table } from "./model.ts";
import type { Border, Borders } from "./types.ts";

const TWIP = 1 / 20;

export interface LaidCell {
  // Left edge and width of the whole cell (border to border), relative to the table.
  x: number;
  w: number;
  gridStart: number;
  gridSpan: number;
  rowSpan: number;
  content: FlowItem[];
  padTop: number;
  padBottom: number;
  padLeft: number;
  padRight: number;
  shd?: string;
  vAlign: string;
  // Height the content needs (padding excluded).
  contentH: number;
  isMergeContinue: boolean;
}

export interface LaidRow {
  cells: LaidCell[];
  height: number;
  exact: boolean;
  cantSplit: boolean;
  isHeader: boolean;
}

export interface LaidTable {
  kind: "t";
  left: number; // offset of the table's left edge inside the container
  colX: number[]; // grid column boundaries, relative to the table
  width: number;
  rows: LaidRow[];
  // Border on each horizontal boundary [0..rows] x column, and each vertical
  // boundary [0..cols] x row.
  hEdges: (Border | null)[][];
  vEdges: (Border | null)[][];
  // Thickness of each horizontal boundary; it is part of the row below it.
  hWidth: number[];
  headerRows: number;
}

export type FlowItem = LaidParagraph | LaidTable;

// How Word combines the space after one paragraph with the space before the
// next: the larger of the two applies (measured against Word's own output).
export function spacingBetween(prev: LaidParagraph, next: LaidParagraph): number {
  if (prev.contextual && next.contextual && prev.styleId === next.styleId) return 0;
  return Math.max(prev.after, next.before);
}

export function paragraphHeight(p: LaidParagraph): number {
  let h = 0;
  for (const l of p.lines) h += l.height;
  return h;
}

export function tableHeight(t: LaidTable): number {
  let h = 0;
  for (const r of t.rows) h += r.height;
  return h;
}

// Height of a stack of items, including inter-paragraph spacing.
export function flowHeight(items: FlowItem[]): number {
  let h = 0;
  let prev: FlowItem | null = null;
  for (const item of items) {
    if (item.kind === "p") {
      h += prev && prev.kind === "p" ? spacingBetween(prev, item) : item.before;
      h += paragraphHeight(item);
    } else {
      if (prev && prev.kind === "p") h += prev.after;
      h += tableHeight(item);
    }
    prev = item;
  }
  if (prev && prev.kind === "p") h += prev.after;
  return h;
}

function borderSignature(p: LaidParagraph): string {
  const b = p.borders;
  if (!b) return "";
  const side = (x: { val: string; sz: number; color: string; space: number } | undefined) => (x ? `${x.val}/${x.sz}/${x.color}/${x.space}` : "-");
  return [side(b.top), side(b.bottom), side(b.left), side(b.right), p.left, p.right].join("|");
}

// Neighbouring paragraphs with identical borders form one bordered block: the
// top line is drawn above the first and the bottom line below the last.
function mergeBorderGroups(items: FlowItem[]): void {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (prev.kind !== "p" || cur.kind !== "p") continue;
    const sig = borderSignature(cur);
    if (!sig || sig !== borderSignature(prev)) continue;
    if (prev.padBottom > 0) {
      const last = prev.lines[prev.lines.length - 1];
      last.height -= prev.padBottom;
      prev.padBottom = 0;
    }
    prev.borderBottomOff = true;
    if (cur.padTop > 0 && cur.lines.length > 0) {
      const first = cur.lines[0];
      first.height -= cur.padTop;
      first.cmds = first.cmds.map((c) => (c.k === "line" ? { ...c, y1: c.y1 - cur.padTop, y2: c.y2 - cur.padTop } : { ...c, y: c.y - cur.padTop }));
      cur.padTop = 0;
    }
    cur.borderTopOff = true;
  }
}

export function layoutBlocks(blocks: Block[], width: number, env: LayoutEnv): FlowItem[] {
  const out: FlowItem[] = [];
  for (const block of blocks) {
    if (block.kind === "p") out.push(layoutParagraph(block, width, env));
    else {
      const table = layoutTable(block, width, env);
      if (table) out.push(table);
    }
  }
  mergeBorderGroups(out);
  return out;
}

// ---- tables ----------------------------------------------------------------------------

function lineWeight(b: Border | null | undefined): number {
  if (!b || b.val === "nil" || b.val === "none") return 0;
  return b.sz;
}

function resolveEdge(existing: { b: Border | null; explicit: boolean } | undefined, b: Border | null, explicit: boolean) {
  if (!existing) return { b, explicit };
  if (explicit && !existing.explicit) return { b, explicit };
  if (!explicit && existing.explicit) return existing;
  return lineWeight(b) >= lineWeight(existing.b) ? { b, explicit } : existing;
}

// ---- auto-fit columns ------------------------------------------------------------------

// Widest extent of a laid-out paragraph's lines (text and pictures).
function naturalWidth(p: LaidParagraph): number {
  let w = 0;
  for (const line of p.lines) {
    for (const c of line.cmds) {
      if (c.k === "text") w = Math.max(w, c.x + textWidth(c.face, c.text, c.size, c.spacing, c.scale));
      else if (c.k === "image") w = Math.max(w, c.x + c.w);
    }
  }
  return w;
}

// The narrowest a paragraph can be made: its longest word (or widest picture). Measured on the unwrapped
// layout, because laying the paragraph out in a sliver breaks inside words instead.
function longestUnit(p: LaidParagraph): number {
  let w = 0;
  for (const line of p.lines) {
    for (const c of line.cmds) {
      if (c.k === "image") w = Math.max(w, c.w);
      else if (c.k === "text") for (const word of c.text.split(/\s+/)) if (word) w = Math.max(w, textWidth(c.face, word, c.size, c.spacing, c.scale));
    }
  }
  return w;
}

// A table Word lays out by content ("auto-fit", the default) whose column grid carries no information:
// equal columns and no cell has a preferred width. That is how generators such as python-docx write
// tables, and Word ignores such a grid and sizes the columns from what is in them. Returns the
// column widths (points) Word would use, or null to keep the grid as written.
//
// Per column, `max` is the widest the content wants to be (nothing wraps) and `min` the narrowest it can be
// (its longest word or picture). Fits: columns grow in proportion to `max` up to the table's width.
// Does not fit: columns share the space between `min` and `max` in proportion to how much they can give.
function autofitColumns(table: Table, grid: number[], containerWidth: number, env: LayoutEnv): number[] | null {
  const cols = grid.length;
  const props = table.props;
  if (cols < 2 || props.layoutFixed === true) return null;
  const cells = table.rows.flatMap((r) => r.cells);
  if (cells.some((c) => c.hasWidth || c.preferredWidth || c.blocks.some((b) => b.kind !== "p"))) return null;

  const max = new Array<number>(cols).fill(0);
  const min = new Array<number>(cols).fill(0);
  const measured = cells
    .filter((c) => c.vMerge !== "continue")
    .map((cell) => {
      const m = cell.props.margins ?? {};
      const pad = ((m.left ?? table.cellMargins.left) + (m.right ?? table.cellMargins.right)) * TWIP;
      let cMax = 0;
      let cMin = 0;
      for (const b of cell.blocks) {
        if (b.kind !== "p") continue;
        // Left-aligned, so centred or right-aligned text is measured by its length, not by where it would sit.
        const left = { ...b, ppr: { ...b.ppr, jc: "left" as const } };
        cMax = Math.max(cMax, naturalWidth(layoutParagraph(left, 100000, env)));
        cMin = Math.max(cMin, longestUnit(layoutParagraph(left, 100000, env)));
      }
      return { cell, max: cMax + pad, min: cMin + pad };
    });
  for (const { cell, max: cMax, min: cMin } of measured) {
    if (cell.gridSpan !== 1) continue;
    max[cell.gridStart] = Math.max(max[cell.gridStart], cMax);
    min[cell.gridStart] = Math.max(min[cell.gridStart], cMin);
  }
  // A merged cell that is wider than the columns under it widens them in proportion to their own widths
  // (Word's behaviour; equally only where they are all empty).
  for (const { cell, max: cMax, min: cMin } of measured) {
    if (cell.gridSpan === 1) continue;
    const idx = Array.from({ length: cell.gridSpan }, (_, i) => cell.gridStart + i).filter((c) => c < cols);
    for (const [arr, need] of [[max, cMax], [min, cMin]] as const) {
      const have = idx.reduce((s, c) => s + arr[c], 0);
      if (need > have) for (const c of idx) arr[c] += have > 0 ? ((need - have) * arr[c]) / have : (need - have) / idx.length;
    }
  }

  const sumMax = max.reduce((a, b) => a + b, 0);
  const sumMin = min.reduce((a, b) => a + b, 0);
  if (sumMax <= 0) return null;
  let target: number;
  if (props.widthType === "dxa" && props.width) target = props.width * TWIP;
  else if (props.widthType === "pct" && props.width) target = (containerWidth * props.width) / 5000;
  else target = Math.min(sumMax, containerWidth);
  if (sumMax <= target) {
    // Content-sized tables (no stated width) stay as narrow as their content.
    const scale = props.widthType === "dxa" || props.widthType === "pct" ? target / sumMax : 1;
    return max.map((m) => m * scale);
  }
  if (sumMin >= target) return min;
  const room = (target - sumMin) / (sumMax - sumMin);
  return max.map((m, c) => min[c] + (m - min[c]) * room);
}

export function layoutTable(table: Table, containerWidth: number, env: LayoutEnv): LaidTable | null {
  const cols = table.grid.length;
  if (cols === 0) return null;
  let grid = table.grid.map((g) => g * TWIP);
  const gridTotal = grid.reduce((a, b) => a + b, 0);
  const props = table.props;
  // A percentage-width table fills its share of the container.
  if (props.widthType === "pct" && props.width && gridTotal > 0) {
    const target = (containerWidth * props.width) / 5000;
    if (Math.abs(target - gridTotal) > gridTotal * 0.01) grid = grid.map((g) => (g * target) / gridTotal);
  }
  const fitted = autofitColumns(table, grid, containerWidth, env);
  if (fitted) grid = fitted;
  const width = grid.reduce((a, b) => a + b, 0);
  const colX: number[] = [0];
  for (const g of grid) colX.push(colX[colX.length - 1] + g);

  const indent = (props.indent ?? 0) * TWIP;
  // Before Word 2013 the table's first-cell *text* (not its edge) sits at the indent.
  let left = env.compatMode < 15 ? indent - table.cellMargins.left * TWIP : indent;
  if (props.jc === "center") left = (containerWidth - width) / 2 + indent;
  else if (props.jc === "right" || props.jc === "end") left = containerWidth - width + indent;

  const rowCount = table.rows.length;
  const owner: (Cell | null)[][] = table.rows.map(() => new Array(cols).fill(null));
  table.rows.forEach((row, r) => {
    for (const cell of row.cells) {
      for (let c = cell.gridStart; c < Math.min(cols, cell.gridStart + cell.gridSpan); c++) owner[r][c] = cell;
    }
  });

  // ---- borders (before content, because cell padding must clear them)
  const tb: Borders = props.borders ?? {};
  type EdgeState = { b: Border | null; explicit: boolean } | undefined;
  const hState: EdgeState[][] = Array.from({ length: rowCount + 1 }, () => new Array(cols).fill(undefined));
  const vState: EdgeState[][] = Array.from({ length: rowCount }, () => new Array(cols + 1).fill(undefined));
  table.rows.forEach((row, r) => {
    for (const cell of row.cells) {
      const cb = cell.props.borders ?? {};
      const span = cell.rowSpan;
      const last = r + span >= rowCount;
      for (let c = cell.gridStart; c < Math.min(cols, cell.gridStart + cell.gridSpan); c++) {
        const top = cb.top ?? (r === 0 ? tb.top : tb.insideH);
        const bottom = cb.bottom ?? (last ? tb.bottom : tb.insideH);
        if (cell.vMerge !== "continue") hState[r][c] = resolveEdge(hState[r][c], top ?? null, cb.top !== undefined);
        hState[r + span][c] = resolveEdge(hState[r + span][c], bottom ?? null, cb.bottom !== undefined);
      }
      for (let rr = r; rr < Math.min(rowCount, r + span); rr++) {
        const first = cell.gridStart === 0;
        const lastCol = cell.gridStart + cell.gridSpan >= cols;
        const leftB = cb.left ?? (first ? tb.left : tb.insideV);
        const rightB = cb.right ?? (lastCol ? tb.right : tb.insideV);
        vState[rr][cell.gridStart] = resolveEdge(vState[rr][cell.gridStart], leftB ?? null, cb.left !== undefined);
        vState[rr][cell.gridStart + cell.gridSpan] = resolveEdge(vState[rr][cell.gridStart + cell.gridSpan], rightB ?? null, cb.right !== undefined);
      }
    }
  });
  const hEdges: (Border | null)[][] = hState.map((edges, b) =>
    edges.map((s, c) => {
      // No line inside a vertically merged cell.
      if (b > 0 && b < rowCount && owner[b - 1][c] && owner[b - 1][c] === owner[b][c]) return null;
      return s && lineWeight(s.b) > 0 ? s.b : null;
    }),
  );
  const vEdges: (Border | null)[][] = vState.map((edges, r) =>
    edges.map((s, b) => {
      // No line inside a horizontally merged cell.
      if (b > 0 && b < cols && owner[r][b - 1] && owner[r][b - 1] === owner[r][b]) return null;
      return s && lineWeight(s.b) > 0 ? s.b : null;
    }),
  );
  const hWidth = hEdges.map((edges) => Math.max(0, ...edges.map((b) => (b ? borderThickness(b) : 0))));

  // ---- rows
  const rows: LaidRow[] = [];
  table.rows.forEach((row, r) => {
    const cells: LaidCell[] = [];
    for (const cell of row.cells) {
      const x0 = colX[Math.min(cell.gridStart, cols)];
      const x1 = colX[Math.min(cell.gridStart + cell.gridSpan, cols)];
      const m = cell.props.margins ?? {};
      const edgeL = vEdges[r][cell.gridStart];
      const edgeR = vEdges[r][Math.min(cols, cell.gridStart + cell.gridSpan)];
      // Text keeps clear of the cell's borders even where the margin is smaller.
      const padLeft = Math.max((m.left ?? table.cellMargins.left) * TWIP, edgeL ? borderThickness(edgeL) : 0);
      const padRight = Math.max((m.right ?? table.cellMargins.right) * TWIP, edgeR ? borderThickness(edgeR) : 0);
      const padTop = (m.top ?? table.cellMargins.top) * TWIP + hWidth[r];
      const padBottom = (m.bottom ?? table.cellMargins.bottom) * TWIP + (r + cell.rowSpan === rowCount ? hWidth[rowCount] : 0);
      const w = x1 - x0;
      const isMergeContinue = cell.vMerge === "continue";
      const content = isMergeContinue ? [] : layoutBlocks(cell.blocks, Math.max(1, w - padLeft - padRight), env);
      const contentH = flowHeight(content);
      cells.push({
        x: x0, w, gridStart: cell.gridStart, gridSpan: cell.gridSpan, rowSpan: cell.rowSpan,
        content, padTop, padBottom, padLeft, padRight,
        shd: cell.props.shd && cell.props.shd !== "auto" ? cell.props.shd : undefined,
        vAlign: cell.props.vAlign ?? "top", contentH, isMergeContinue,
      });
    }
    const minH = row.height ? row.height.value * TWIP : 0;
    let height = 0;
    for (const c of cells) if (c.rowSpan === 1 && !c.isMergeContinue) height = Math.max(height, c.contentH + c.padTop + c.padBottom);
    // The row's height bounds include its borders.
    const extra = hWidth[r] + (r === rowCount - 1 ? hWidth[rowCount] : 0);
    if (row.height?.rule === "exact") height = minH + extra;
    else height = Math.max(height, minH + extra);
    rows.push({ cells, height, exact: row.height?.rule === "exact", cantSplit: row.cantSplit, isHeader: row.isHeader });
  });

  // A vertically merged cell that needs more than its rows provide grows the last row.
  rows.forEach((row, r) => {
    for (const c of row.cells) {
      if (c.rowSpan <= 1) continue;
      let have = 0;
      for (let k = r; k < Math.min(rowCount, r + c.rowSpan); k++) have += rows[k].height;
      const need = c.contentH + c.padTop + c.padBottom;
      if (need > have) rows[Math.min(rowCount - 1, r + c.rowSpan - 1)].height += need - have;
    }
  });

  let headerRows = 0;
  while (headerRows < rows.length && rows[headerRows].isHeader) headerRows += 1;

  return { kind: "t", left, colX, width, rows, hEdges, vEdges, hWidth, headerRows };
}

// ---- drawing helpers ---------------------------------------------------------------------

export function borderThickness(b: Border): number {
  const w = Math.max(0.25, b.sz / 8);
  return b.val === "double" ? w * 3 : w;
}

export function borderColor(b: Border): string {
  return b.color === "auto" ? "000000" : b.color;
}

export function borderCmds(b: Border, x1: number, y1: number, x2: number, y2: number): Cmd[] {
  const w = Math.max(0.25, b.sz / 8);
  const color = borderColor(b);
  const horizontal = y1 === y2;
  if (b.val === "double" || b.val === "triple") {
    const gap = w;
    const off = w;
    return [-1, 1].map(
      (s): Cmd => ({
        k: "line",
        x1: horizontal ? x1 : x1 + s * off,
        y1: horizontal ? y1 + s * off : y1,
        x2: horizontal ? x2 : x2 + s * off,
        y2: horizontal ? y2 + s * off : y2,
        w: Math.max(0.25, w * 0.7),
        color,
        dash: gap ? undefined : undefined,
      }),
    );
  }
  const dash = b.val === "dashed" || b.val === "dashSmallGap" ? [w * 4, w * 2] : b.val === "dotted" ? [w, w * 1.5] : b.val === "dotDash" ? [w * 4, w * 1.5, w, w * 1.5] : undefined;
  return [{ k: "line", x1, y1, x2, y2, w, color, dash }];
}

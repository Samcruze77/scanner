// Pagination: places laid-out paragraphs and tables onto pages, following Word's
// rules for page breaks (explicit breaks, page-break-before, keep-with-next,
// keep-lines, widow/orphan control), sections, columns, repeated table header
// rows, headers/footers and page numbering.

import {
  borderCmds,
  flowHeight,
  layoutBlocks,
  paragraphHeight,
  spacingBetween,
  tableHeight,
  type FlowItem,
  type LaidCell,
  type LaidRow,
  type LaidTable,
} from "./flow.ts";
import type { Cmd, LaidParagraph, LayoutEnv } from "./layout.ts";
import type { Block, DocModel, ImageRef, SectionModel } from "./model.ts";
import type { Border, Borders } from "./types.ts";

const TWIP = 1 / 20;
const EPS = 0.05;

export interface PageOut {
  width: number;
  height: number;
  behind: Cmd[];
  cmds: Cmd[];
  front: Cmd[];
  number: number; // displayed page number
  sectionIndex: number;
  // Header/footer are added at the end, once the page count is known.
  section: SectionModel;
  indexInSection: number;
}

export function shiftCmd(cmd: Cmd, dx: number, dy: number): Cmd {
  if (cmd.k === "line") return { ...cmd, x1: cmd.x1 + dx, x2: cmd.x2 + dx, y1: cmd.y1 + dy, y2: cmd.y2 + dy };
  return { ...cmd, x: cmd.x + dx, y: cmd.y + dy } as Cmd;
}

function push(out: Cmd[], cmds: Cmd[], dx: number, dy: number): void {
  for (const c of cmds) out.push(shiftCmd(c, dx, dy));
}

// ---- emitting ---------------------------------------------------------------------------

function emitParagraphLines(p: LaidParagraph, from: number, to: number, x: number, y: number, out: Cmd[]): number {
  let cy = y;
  for (let i = from; i < to; i++) {
    push(out, p.lines[i].cmds, x, cy);
    cy += p.lines[i].height;
  }
  return cy;
}

function emitParagraphDecor(p: LaidParagraph, x: number, top: number, bottom: number, first: boolean, last: boolean, out: Cmd[]): void {
  if (p.shd) out.push({ k: "rect", x: x + p.left, y: top, w: p.right - p.left, h: bottom - top, color: p.shd });
  const b: Borders | undefined = p.borders;
  if (!b) return;
  const x1 = x + p.left - (b.left ? b.left.space : 0);
  const x2 = x + p.right + (b.right ? b.right.space : 0);
  const edge = (border: Border | undefined, ax: number, ay: number, bx: number, by: number) => {
    if (border && border.val !== "nil" && border.val !== "none") out.push(...borderCmds(border, ax, ay, bx, by));
  };
  if (first && b.top && !p.borderTopOff) {
    const yy = top + Math.max(0.25, b.top.sz / 8) / 2;
    edge(b.top, x1, yy, x2, yy);
  }
  if (last && b.bottom && !p.borderBottomOff) {
    const yy = bottom - Math.max(0.25, b.bottom.sz / 8) / 2;
    edge(b.bottom, x1, yy, x2, yy);
  }
  edge(b.left, x1, top, x1, bottom);
  edge(b.right, x2, top, x2, bottom);
}

// A whole flow (table cell, header, footer) drawn top to bottom without page logic.
export function emitFlow(items: FlowItem[], x: number, y: number, out: Cmd[]): number {
  let cy = y;
  let prev: FlowItem | null = null;
  for (const item of items) {
    if (item.kind === "p") {
      cy += prev ? (prev.kind === "p" ? spacingBetween(prev, item) : item.before) : item.before;
      const top = cy;
      const end = emitParagraphLines(item, 0, item.lines.length, x, cy, out);
      emitParagraphDecor(item, x, top, end, true, true, out);
      cy = end;
    } else {
      if (prev && prev.kind === "p") cy += prev.after;
      emitTable(item, x, cy, out, 0, item.rows.length);
      cy += tableHeight(item);
    }
    prev = item;
  }
  return cy;
}

function emitCell(cell: LaidCell, tableX: number, y: number, height: number, out: Cmd[], contentOverride?: FlowItem[]): void {
  const x = tableX + cell.x;
  if (cell.shd) out.push({ k: "rect", x, y, w: cell.w, h: height, color: cell.shd });
  const content = contentOverride ?? cell.content;
  if (content.length === 0) return;
  const contentH = contentOverride ? flowHeight(contentOverride) : cell.contentH;
  const inner = height - cell.padTop - cell.padBottom;
  let offset = 0;
  if (cell.vAlign === "center") offset = Math.max(0, (inner - contentH) / 2);
  else if (cell.vAlign === "bottom") offset = Math.max(0, inner - contentH);
  emitFlow(content, x + cell.padLeft, y + cell.padTop + offset, out);
}

// Emits rows [from, to) of a table at (x, y). Row heights come from the table.
function emitTable(t: LaidTable, x: number, y: number, out: Cmd[], from: number, to: number): void {
  const tx = x + t.left;
  const rowY: number[] = [];
  let cy = y;
  for (let r = from; r < to; r++) {
    rowY[r] = cy;
    cy += t.rows[r].height;
  }
  for (let r = from; r < to; r++) {
    const row = t.rows[r];
    for (const cell of row.cells) {
      if (cell.isMergeContinue) continue;
      let h = 0;
      for (let k = r; k < Math.min(to, r + cell.rowSpan); k++) h += t.rows[k].height;
      emitCell(cell, tx, rowY[r], h, out);
    }
  }
  emitBorders(t, tx, from, to, rowY, cy, out);
}

function emitBorders(t: LaidTable, tx: number, from: number, to: number, rowY: number[], endY: number, out: Cmd[]): void {
  const cols = t.colX.length - 1;
  for (let b = from; b <= to; b++) {
    const w = t.hWidth[b] ?? 0;
    const y = b === to ? endY - w / 2 : rowY[b] + w / 2;
    for (let c = 0; c < cols; c++) {
      const border = t.hEdges[b]?.[c];
      if (border) out.push(...borderCmds(border, tx + t.colX[c], y, tx + t.colX[c + 1], y));
    }
  }
  for (let r = from; r < to; r++) {
    const y1 = rowY[r];
    const y2 = r + 1 < to ? rowY[r + 1] : endY;
    for (let b = 0; b <= cols; b++) {
      const border = t.vEdges[r]?.[b];
      if (border) out.push(...borderCmds(border, tx + t.colX[b], y1, tx + t.colX[b], y2));
    }
  }
}

// ---- splitting ---------------------------------------------------------------------------

// Splits a flow so the head fits in `avail` points; the tail (if any) continues.
function sliceFlow(items: FlowItem[], avail: number): { head: FlowItem[]; tail: FlowItem[] } {
  const head: FlowItem[] = [];
  let used = 0;
  let prev: FlowItem | null = null;
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (item.kind === "p") {
      const gap = prev ? (prev.kind === "p" ? spacingBetween(prev, item) : item.before) : item.before;
      let k = 0;
      let h = used + gap;
      while (k < item.lines.length && h + item.lines[k].height <= avail + EPS) {
        h += item.lines[k].height;
        k += 1;
      }
      if (k === item.lines.length) {
        head.push(item);
        used = h;
        prev = item;
        continue;
      }
      const n = item.lines.length;
      if (item.widowControl && n > 1) {
        if (k === 1) k = 0;
        else if (n - k === 1 && k > 2) k -= 1;
      }
      if (item.keepLines) k = 0;
      if (k === 0) return { head, tail: items.slice(idx) };
      head.push({ ...item, lines: item.lines.slice(0, k), after: 0 });
      return { head, tail: [{ ...item, lines: item.lines.slice(k), before: 0, pageBreakBefore: false }, ...items.slice(idx + 1)] };
    }
    const tableGap = prev && prev.kind === "p" ? prev.after : 0;
    const th = tableHeight(item);
    if (used + tableGap + th <= avail + EPS) {
      head.push(item);
      used += tableGap + th;
      prev = item;
      continue;
    }
    return { head, tail: items.slice(idx) };
  }
  return { head, tail: [] };
}

// ---- header / footer -----------------------------------------------------------------------

type HFKind = "default" | "first" | "even";

function hfKind(section: SectionModel, indexInSection: number, number: number, evenAndOdd: boolean): HFKind {
  if (indexInSection === 0 && section.props.titlePg) return "first";
  if (evenAndOdd && number % 2 === 0) return "even";
  return "default";
}

function hfBlocks(list: { default?: Block[]; first?: Block[]; even?: Block[] }, kind: HFKind): Block[] | undefined {
  return list[kind] ?? (kind === "default" ? undefined : undefined);
}

// ---- pagination ------------------------------------------------------------------------------

interface Geometry {
  pageW: number;
  pageH: number;
  left: number;
  contentW: number;
  colW: number;
  colX: number[];
  colCount: number;
}

function geometryOf(section: SectionModel): Geometry {
  const p = section.props;
  const pageW = p.pageW * TWIP;
  const pageH = p.pageH * TWIP;
  const left = (p.left + p.gutter) * TWIP;
  const contentW = pageW - left - p.right * TWIP;
  const count = p.colCount;
  const space = p.colSpace * TWIP;
  const colX: number[] = [];
  let colW: number;
  if (p.colWidths && p.colWidths.length === count) {
    let cx = 0;
    for (let i = 0; i < count; i++) {
      colX.push(cx);
      cx += p.colWidths[i] * TWIP + space;
    }
    colW = p.colWidths[0] * TWIP;
  } else {
    colW = (contentW - space * (count - 1)) / count;
    for (let i = 0; i < count; i++) colX.push(i * (colW + space));
  }
  return { pageW, pageH, left, contentW, colW, colX, colCount: count };
}

export function paginate(model: DocModel, env: LayoutEnv): PageOut[] {
  const pages: PageOut[] = [];
  let displayNumber = 0;

  let page: PageOut | null = null;
  let geo: Geometry = geometryOf(model.sections[0]);
  let section: SectionModel = model.sections[0];
  let sectionIndex = 0;
  let bodyTop = 0;
  let bodyBottom = 0;
  let col = 0;
  let y = 0;
  // Space after the previous block, owed to whatever comes next.
  let prevAfter = 0;
  let lastItem: FlowItem | null = null;
  // Whether we are at the top of a column, and how we got there: Word drops
  // "space before" after an automatic break but keeps it after a hard one.
  let atTop = true;
  let topKind: "start" | "hard" | "natural" = "start";

  function hfHeight(list: SectionModel["headers"], kind: HFKind): number {
    const blocks = hfBlocks(list, kind);
    if (!blocks || blocks.length === 0) return 0;
    return flowHeight(layoutBlocks(blocks, geo.contentW, { ...env, pageNumber: "1", pageCount: "1" }));
  }

  function startPage(kind: "hard" | "natural" | "start", resetNumber: boolean): void {
    if (resetNumber && section.props.pgNumStart !== undefined) displayNumber = section.props.pgNumStart;
    else displayNumber += 1;
    const indexInSection = pages.filter((p) => p.sectionIndex === sectionIndex).length;
    page = {
      width: geo.pageW, height: geo.pageH, behind: [], cmds: [], front: [],
      number: displayNumber, sectionIndex, section, indexInSection,
    };
    pages.push(page);
    const hf = hfKind(section, indexInSection, displayNumber, model.evenAndOdd);
    const headerH = hfHeight(section.headers, hf);
    const footerH = hfHeight(section.footers, hf);
    bodyTop = Math.max(section.props.top * TWIP, headerH > 0 ? section.props.header * TWIP + headerH : 0);
    bodyBottom = Math.min(geo.pageH - section.props.bottom * TWIP, footerH > 0 ? geo.pageH - section.props.footer * TWIP - footerH : geo.pageH);
    col = 0;
    y = bodyTop;
    prevAfter = 0;
    lastItem = null;
    atTop = true;
    topKind = kind;
  }

  function nextColumnOrPage(hard = false): void {
    if (col + 1 < geo.colCount) {
      col += 1;
      y = bodyTop;
      prevAfter = 0;
      lastItem = null;
      atTop = true;
      topKind = hard ? "hard" : "natural";
    } else {
      startPage(hard ? "hard" : "natural", false);
    }
  }

  const colLeft = () => geo.left + geo.colX[col];

  function gapBefore(p: LaidParagraph): number {
    if (atTop) return topKind === "natural" ? 0 : p.before;
    if (lastItem && lastItem.kind === "p") return spacingBetween(lastItem, p);
    return prevAfter + p.before;
  }

  // ---- paragraphs

  function placeParagraph(p: LaidParagraph, all: FlowItem[], index: number): void {
    // "Page break before" drops the paragraph's space before at the top of the new
    // page, like an automatic break (measured against Word: a heading with 16pt
    // before sits at the margin). Only an explicit break character keeps it.
    if (p.pageBreakBefore && !atTop) nextColumnOrPage(false);
    let from = 0;
    let first = true;
    for (;;) {
      let end = p.lines.length;
      for (let i = from; i < p.lines.length; i++) {
        if (p.lines[i].breakAfter) {
          end = i + 1;
          break;
        }
      }
      placeSegment(p, from, end, first, all, index);
      first = false;
      const forced = end > 0 && p.lines[end - 1].breakAfter !== undefined;
      from = end;
      if (forced) nextColumnOrPage(true);
      if (from >= p.lines.length) break;
    }
    lastItem = p;
    prevAfter = p.after;
  }

  // Height needed to keep a "keep with next" chain together with the start of
  // the block that follows it.
  function neededWithNext(all: FlowItem[], index: number): number {
    let need = 0;
    for (let j = index; j < all.length; j++) {
      const it = all[j];
      const prev: FlowItem | null = j === index ? lastItem : all[j - 1];
      if (it.kind === "t") {
        need += (prev && prev.kind === "p" ? prev.after : 0) + (it.rows[0]?.height ?? 0);
        break;
      }
      const gap = j === index ? gapBefore(it) : prev && prev.kind === "p" ? spacingBetween(prev, it) : it.before;
      if (it.keepNext && j + 1 < all.length) {
        need += gap + paragraphHeight(it);
        continue;
      }
      const lines = it.keepLines ? it.lines.length : Math.min(it.lines.length, 2);
      let h = 0;
      for (let k = 0; k < lines; k++) h += it.lines[k].height;
      need += gap + h;
      break;
    }
    return need;
  }

  function placeSegment(p: LaidParagraph, from: number, to: number, isFirstSegment: boolean, all: FlowItem[], index: number): void {
    let start = from;
    let firstFragment = isFirstSegment;
    while (start < to) {
      const gap = firstFragment ? gapBefore(p) : 0;
      const avail = bodyBottom - y;

      if (firstFragment && p.keepNext && !atTop && index + 1 < all.length) {
        const need = neededWithNext(all, index);
        if (need > avail + EPS && need <= bodyBottom - bodyTop + EPS) {
          nextColumnOrPage();
          continue;
        }
      }

      let k = 0;
      let h = gap;
      while (start + k < to && h + p.lines[start + k].height <= avail + EPS) {
        h += p.lines[start + k].height;
        k += 1;
      }
      const remaining = to - start;
      if (k < remaining) {
        let take = k;
        const before = start;
        if (p.widowControl && p.lines.length > 1) {
          if (before === 0 && take === 1) take = 0;
          else if (remaining - take === 1) {
            if (before + take - 1 >= 2) take -= 1;
            else if (before === 0) take = 0;
          }
        }
        if (p.keepLines && before === 0) take = 0;
        if (take === 0) {
          if (y <= bodyTop + EPS) take = Math.max(1, k);
          else {
            nextColumnOrPage();
            continue;
          }
        }
        k = take;
      }

      const pg = page as PageOut;
      y += gap;
      const x = colLeft();
      const top = y;
      if (firstFragment) for (const image of p.anchors) placeAnchor(image, pg, x, top);
      const end = emitParagraphLines(p, start, start + k, x, y, pg.cmds);
      if (p.shd || p.borders) {
        const decor: Cmd[] = [];
        emitParagraphDecor(p, x, top, end, firstFragment, start + k >= p.lines.length, decor);
        pg.cmds.splice(0, 0, ...decor);
      }
      y = end;
      atTop = false;
      start += k;
      firstFragment = false;
      if (start < to) nextColumnOrPage();
    }
  }

  function placeAnchor(image: ImageRef, pg: PageOut, colX: number, top: number): void {
    const a = image.anchor;
    if (!a) return;
    const w = image.widthPt;
    const h = image.heightPt;
    const marginL = geo.left;
    const marginR = geo.pageW - section.props.right * TWIP;
    const [hl, hr] = a.hRel === "page" ? [0, geo.pageW] : a.hRel === "margin" ? [marginL, marginR] : [colX, colX + geo.colW];
    let ax: number;
    if (a.hAlign === "center") ax = hl + (hr - hl - w) / 2;
    else if (a.hAlign === "right") ax = hr - w;
    else if (a.hAlign === "left") ax = hl;
    else ax = hl + a.hOffsetPt;
    const vTop = a.vRel === "page" ? 0 : a.vRel === "margin" || a.vRel === "topMargin" ? section.props.top * TWIP : top;
    const vBottom = a.vRel === "page" ? geo.pageH : a.vRel === "margin" ? geo.pageH - section.props.bottom * TWIP : top + h;
    let ay: number;
    if (a.vAlign === "center") ay = vTop + (vBottom - vTop - h) / 2;
    else if (a.vAlign === "bottom") ay = vBottom - h;
    else if (a.vAlign === "top") ay = vTop;
    else ay = vTop + a.vOffsetPt;
    (a.behind ? pg.behind : pg.front).push({ k: "image", x: ax, y: ay, w, h, image });
  }

  // ---- tables

  function splittable(row: LaidRow): boolean {
    return !row.cantSplit && row.cells.every((c) => c.rowSpan === 1 && !c.isMergeContinue);
  }

  // Splits one row at `avail` points; null when no cell can place anything.
  function sliceRow(row: LaidRow, avail: number): { head: LaidRow; tail: LaidRow } | null {
    const headCells: LaidCell[] = [];
    const tailCells: LaidCell[] = [];
    let anyHead = false;
    let anyTail = false;
    let headH = 0;
    let tailH = 0;
    for (const cell of row.cells) {
      const room = avail - cell.padTop - cell.padBottom;
      const { head, tail } = sliceFlow(cell.content, room);
      // A cell with content that cannot place even a first line here (widow
      // control, keep-lines) moves the whole row to the next page, as in Word.
      if (cell.content.length > 0 && head.length === 0) return null;
      if (head.length > 0) anyHead = true;
      if (tail.length > 0) anyTail = true;
      const hh = flowHeight(head);
      const th = flowHeight(tail);
      headCells.push({ ...cell, content: head, contentH: hh });
      tailCells.push({ ...cell, content: tail, contentH: th });
      headH = Math.max(headH, hh + cell.padTop + cell.padBottom);
      tailH = Math.max(tailH, th + cell.padTop + cell.padBottom);
    }
    if (!anyHead || !anyTail) return null;
    return {
      head: { ...row, cells: headCells, height: Math.min(avail, headH) },
      tail: { ...row, cells: tailCells, height: tailH, isHeader: false },
    };
  }

  function placeTable(t: LaidTable): void {
    if (t.rows.length === 0) return;
    if (!atTop) y += prevAfter;
    let pending = t.rows.map((row, source) => ({ row, source }));
    let continuation = false;

    while (pending.length > 0) {
      const frag: { row: LaidRow; source: number }[] = [];
      let used = 0;
      const fresh = y <= bodyTop + EPS;
      if (continuation) {
        for (let h = 0; h < t.headerRows; h++) {
          frag.push({ row: t.rows[h], source: h });
          used += t.rows[h].height;
        }
      }
      const headerCount = frag.length;

      while (pending.length > 0) {
        const next = pending[0];
        const avail = bodyBottom - y - used;
        if (next.row.height <= avail + EPS) {
          frag.push(next);
          used += next.row.height;
          pending.shift();
          continue;
        }
        if (splittable(next.row)) {
          const slice = sliceRow(next.row, avail);
          if (slice) {
            frag.push({ row: slice.head, source: next.source });
            used += slice.head.height;
            pending = [{ row: slice.tail, source: next.source }, ...pending.slice(1)];
            break;
          }
        }
        if (frag.length === headerCount && fresh) {
          // Does not fit even alone on an empty page: place it anyway.
          frag.push(next);
          used += next.row.height;
          pending.shift();
        }
        break;
      }

      if (frag.length > headerCount) {
        const pg = page as PageOut;
        const sub: LaidTable = { ...t, rows: frag.map((f) => f.row), hEdges: [], vEdges: [], hWidth: [] };
        for (const f of frag) {
          sub.hEdges.push(t.hEdges[f.source]);
          sub.vEdges.push(t.vEdges[f.source]);
          sub.hWidth.push(t.hWidth[f.source]);
        }
        const lastSource = frag[frag.length - 1].source;
        sub.hEdges.push(t.hEdges[lastSource + 1] ?? t.hEdges[t.hEdges.length - 1]);
        sub.hWidth.push(lastSource === t.rows.length - 1 ? t.hWidth[lastSource + 1] : 0);
        emitTable(sub, colLeft(), y, pg.cmds, 0, frag.length);
        y += used;
        atTop = false;
      }
      if (pending.length > 0) {
        nextColumnOrPage();
        continuation = true;
      }
    }
    lastItem = t;
    prevAfter = 0;
  }

  // ---- sections

  for (let si = 0; si < model.sections.length; si++) {
    const sec = model.sections[si];
    sectionIndex = si;
    section = sec;
    geo = geometryOf(sec);
    const items = layoutBlocks(sec.blocks, geo.colW, env);

    if (pages.length === 0) {
      startPage("start", true);
    } else if (sec.props.type === "continuous") {
      col = 0;
    } else {
      const wantsOdd = sec.props.type === "oddPage";
      const wantsEven = sec.props.type === "evenPage";
      startPage("hard", true);
      if ((wantsOdd && displayNumber % 2 === 0) || (wantsEven && displayNumber % 2 === 1)) startPage("hard", false);
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "p") placeParagraph(item, items, i);
      else placeTable(item);
    }
  }

  // ---- headers and footers, once every page and the page count are known.

  const total = pages.length;
  for (const pg of pages) {
    const sec = pg.section;
    const g = geometryOf(sec);
    const kind = hfKind(sec, pg.indexInSection, pg.number, model.evenAndOdd);
    const hEnv: LayoutEnv = { ...env, pageNumber: String(pg.number), pageCount: String(total) };
    const header = hfBlocks(sec.headers, kind);
    if (header && header.length > 0) {
      emitFlow(layoutBlocks(header, g.contentW, hEnv), g.left, sec.props.header * TWIP, pg.cmds);
    }
    const footer = hfBlocks(sec.footers, kind);
    if (footer && footer.length > 0) {
      const items = layoutBlocks(footer, g.contentW, hEnv);
      emitFlow(items, g.left, g.pageH - sec.props.footer * TWIP - flowHeight(items), pg.cmds);
    }
  }

  return pages;
}

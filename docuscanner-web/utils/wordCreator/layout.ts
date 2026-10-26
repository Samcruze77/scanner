// Where the page breaks fall. Pure arithmetic over measured block and line positions, so it can be tested without a browser.
//
// It follows the rules Word applies to the .docx this editor exports:
//  - a paragraph is split across two pages between lines, never inside a line;
//  - widow/orphan control: when a paragraph is split at least two lines stay on each page, so a paragraph of fewer than four lines
//    moves whole;
//  - "keep lines together" blocks (headings, the title) are never split, and "keep with next" blocks (headings) stay on the same page
//    as the first lines of the block that follows them;
//  - space before a block is not used at the top of a page that a break started (it is used at the very top of the first page);
//  - a picture or rule is never split, and one taller than a page is left to cross;
//  - a page break takes no room: it ends the page it is on, even when that page is full, and two in a row leave a blank page.
//
// The space between two blocks is the larger of the first one's space after and the second one's space before (as in Word), which is
// how CSS collapses margins, so the measured positions already include it.
import { DEFAULT_MARGINS, pageViewGeometry, type PageGeometry } from "./model.ts";

const DEFAULT_GEOMETRY = pageViewGeometry(DEFAULT_MARGINS);
export const GAP = DEFAULT_GEOMETRY.gapTotal; // bottom margin + strip + top margin, for the default margins
export const PITCH = DEFAULT_GEOMETRY.pitch;

// Whole lines that must stay on each side of a split (Word's widow/orphan control).
export const MIN_LINES = 2;

export interface LayoutBlock {
  // The block's own box (no margins), in pixels from the top of the first page's text area, as laid out WITHOUT any page-break gaps.
  top: number;
  bottom: number;
  marginTop?: number;
  marginBottom?: number;
  // The block's line boxes as n + 1 edges (the top of line 1 ... the bottom of line n), in the same coordinates. Only asked for
  // when the block reaches the end of a page, so measuring them can wait until then. Unknown means "do not split".
  lines?: () => number[] | null;
  // Word puts the extra space of a line spacing above single (1.15, 1.5, double...) BELOW the text, and a line fits on a page when its text
  // does: the extra may hang into the bottom margin. This is the fraction of every line's height that is such extra, (multiple - 1) / multiple.
  hang?: number;
  keepNext?: boolean;
  keepLines?: boolean;
  // This block is a page break: whatever comes next starts on a new page, however much room is left on this one.
  breakAfter?: boolean;
}

// `line` 0 is a break before the block; k > 0 is a break after its k-th line. `height` is the empty space to insert there.
export interface PageBreakAt {
  block: number;
  line: number;
  height: number;
}

type Geometry = Pick<PageGeometry, "contentH" | "gapTotal" | "pitch">;

const EPS = 0.5;

export function layoutPages(blocks: LayoutBlock[], geometry: Geometry = DEFAULT_GEOMETRY): { breaks: PageBreakAt[]; pages: number } {
  const { contentH, pitch } = geometry;
  const breaks: PageBreakAt[] = [];
  const marginTop = (b: LayoutBlock) => b.marginTop ?? 0;
  const marginBottom = (b: LayoutBlock) => b.marginBottom ?? 0;
  let shift = 0; // how far everything from here on has moved down because of the gaps inserted so far
  let pageStart = 0; // where the current page's text starts (in shifted coordinates)
  let lastBottom = 0;
  let forceNext = false;
  const edgeCache = new Map<number, number[] | null>();
  const edgesOf = (i: number) => {
    if (!edgeCache.has(i)) edgeCache.set(i, blocks[i].keepLines ? null : (blocks[i].lines?.() ?? null));
    return edgeCache.get(i)!;
  };
  const bottomOf = (i: number) => blocks[i].bottom + shift;
  // The edge of line l (0-based) that has to fit on the page: its bottom less the extra line spacing that may hang below.
  const fitEdge = (i: number, edges: number[], l: number) => edges[l + 1] - (blocks[i].hang ?? 0) * (edges[l + 1] - edges[l]) + shift;
  // Where the block's last line ends for the purpose of fitting on the page.
  const fitBottom = (i: number) => {
    const blk = blocks[i];
    if (!blk.hang) return bottomOf(i);
    const edges = edgesOf(i);
    if (edges) return fitEdge(i, edges, edges.length - 2);
    return blk.bottom - blk.hang * (blk.bottom - blk.top) + shift; // one line, or a block that cannot be split
  };

  // Starts block i on the next page, with its own box at the top of that page's text (its space before is not used there). The gap
  // goes between the previous block's space after and this block's space before, so it is smaller than the distance moved by the
  // smaller of the two (they overlapped before the gap was there).
  const startBlockOnNextPage = (i: number) => {
    const blk = blocks[i];
    const next = pageStart + pitch;
    const moved = Math.max(0, next - (blk.top + shift));
    const overlap = i > 0 ? Math.min(marginBottom(blocks[i - 1]), marginTop(blk)) : 0;
    breaks.push({ block: i, line: 0, height: Math.round(Math.max(0, moved - overlap) * 100) / 100 });
    shift += moved;
    pageStart = next;
  };
  // Starts the k-th line of block i on the next page.
  const startLineOnNextPage = (i: number, line: number, lineTop: number) => {
    const next = pageStart + pitch;
    const moved = Math.max(0, next - lineTop);
    breaks.push({ block: i, line, height: Math.round(moved * 100) / 100 });
    shift += moved;
    pageStart = next;
  };

  // The first lines of block i that must be on the same page as the block before it (all of it when it cannot be split).
  const leadBottom = (i: number) => {
    const edges = edgesOf(i);
    if (edges && edges.length - 1 >= MIN_LINES * 2) return fitEdge(i, edges, MIN_LINES - 1);
    return fitBottom(i);
  };

  for (let i = 0; i < blocks.length; i++) {
    const blk = blocks[i];
    while (blk.top + shift >= pageStart + pitch - EPS) pageStart += pitch;
    // the first block of the document, or one that is the first on its page already
    const atPageTop = () => i === 0 || blk.top + shift <= pageStart + EPS || blocks[i - 1].bottom + shift <= pageStart + EPS;

    if (blk.breakAfter) {
      // a page break takes no room and always stays on the page it ends; one straight after another makes a blank page
      if (forceNext) startBlockOnNextPage(i);
      lastBottom = Math.max(lastBottom, Math.min(blk.top + shift, pageStart + contentH));
      forceNext = true;
      continue;
    }

    if (forceNext) {
      forceNext = false;
      // after a page break the next block starts on a fresh page (unless it is already at the very top of one)
      if (!atPageTop()) startBlockOnNextPage(i);
    } else if (blk.top + shift >= pageStart + contentH - EPS) {
      startBlockOnNextPage(i);
    } else if (blk.keepNext && (i === 0 || !blocks[i - 1].keepNext)) {
      // the start of a "keep with next" group: the group and the first lines after it share a page, or all move to the next one
      let anchor = i;
      while (anchor < blocks.length && blocks[anchor].keepNext && !blocks[anchor].breakAfter) anchor++;
      const need = anchor < blocks.length && !blocks[anchor].breakAfter ? leadBottom(anchor) : fitBottom(anchor - 1);
      if (need > pageStart + contentH + EPS && !atPageTop()) startBlockOnNextPage(i);
    }

    // The block now starts on the page it is on. Does it all fit, or must it be split?
    let lineBase = 0; // the first line of the part of the block that is still to be placed
    for (let guard = 0; guard < 500 && bottomOf(i) > pageStart + contentH + EPS && fitBottom(i) > pageStart + contentH + EPS; guard++) {
      const edges = edgesOf(i);
      const n = edges ? edges.length - 1 : 0;
      if (!edges || n < 2) {
        // cannot be split: it moves whole unless it is already at the top of a page (then it crosses, as a huge picture does)
        if (lineBase === 0 && !atPageTop()) startBlockOnNextPage(i);
        break;
      }
      const pageEnd = pageStart + contentH;
      let fit = 0;
      for (let l = lineBase; l < n && fitEdge(i, edges, l) <= pageEnd + EPS; l++) fit++;
      const remaining = n - lineBase;
      let take = fit;
      // widow/orphan control
      if (remaining - take < MIN_LINES) take = remaining - MIN_LINES;
      if (take < MIN_LINES) take = 0;
      if (take === 0) {
        if (lineBase === 0 && !atPageTop()) {
          startBlockOnNextPage(i);
          continue;
        }
        // it is the top of a page and the rule cannot be met: split where the lines stop fitting
        take = Math.min(fit, remaining - 1);
        if (take < 1) break;
      }
      const at = lineBase + take;
      startLineOnNextPage(i, at, edges[at] + shift);
      lineBase = at;
    }

    lastBottom = bottomOf(i);
  }

  if (!blocks.length) return { breaks, pages: 1 };
  let k = Math.floor((lastBottom - EPS) / pitch);
  if (lastBottom - k * pitch > contentH + EPS) k++;
  // A page break at the very end still opens a (blank) page to continue on.
  if (forceNext) k++;
  return { breaks, pages: Math.max(1, k + 1) };
}

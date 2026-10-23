// Where the page breaks fall. Pure arithmetic over measured block heights, so it can be tested without a browser.
import { DEFAULT_MARGINS, pageViewGeometry, type PageGeometry } from "./model.ts";

const DEFAULT_GEOMETRY = pageViewGeometry(DEFAULT_MARGINS);
export const GAP = DEFAULT_GEOMETRY.gapTotal; // bottom margin + strip + top margin, for the default margins
export const PITCH = DEFAULT_GEOMETRY.pitch;

export interface Spacer {
  index: number;
  height: number;
}

export interface MeasuredBlock {
  top: number;
  bottom: number;
  // A page break: whatever comes next starts on a new page, however much room is left on this one.
  breakAfter?: boolean;
}

export function layoutPages(blocks: MeasuredBlock[], geometry: Pick<PageGeometry, "contentH" | "gapTotal" | "pitch"> = DEFAULT_GEOMETRY): { spacers: Spacer[]; pages: number } {
  const { contentH, pitch } = geometry;
  const spacers: Spacer[] = [];
  let shift = 0;
  let pageStart = 0;
  let bottom = 0;
  let forceNext = false;
  blocks.forEach((blk, index) => {
    let ts = blk.top + shift;
    let bs = blk.bottom + shift;
    while (ts >= pageStart + pitch - 0.5) pageStart += pitch;
    const pageEnd = pageStart + contentH;
    const push = () => {
      const add = pageStart + pitch - ts;
      spacers.push({ index, height: Math.round(add * 100) / 100 });
      shift += add;
      ts += add;
      bs += add;
      pageStart += pitch;
    };
    if (forceNext) {
      // After a page break the next block starts on a fresh page (unless it is already at the very top of one).
      if (ts > pageStart + 0.5 || ts >= pageEnd - 0.5) push();
      forceNext = false;
    } else if (ts >= pageEnd - 0.5) push();
    else if (bs > pageEnd + 0.5 && blk.bottom - blk.top <= contentH + 0.5 && ts > pageStart + 0.5) push();
    bottom = bs;
    if (blk.breakAfter) forceNext = true;
  });
  if (!blocks.length) return { spacers, pages: 1 };
  let k = Math.floor((bottom - 0.5) / pitch);
  if (bottom - k * pitch > contentH + 0.5) k++;
  // A page break at the very end still opens a (blank) page to continue on.
  if (forceNext) k++;
  return { spacers, pages: Math.max(1, k + 1) };
}

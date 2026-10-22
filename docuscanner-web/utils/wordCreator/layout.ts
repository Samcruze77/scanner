// Where the page breaks fall. Pure arithmetic over measured block heights, so it can be tested without a browser.
import { CONTENT_HEIGHT_PX, PAGE } from "./model.ts";

export const GAP = PAGE.marginPx * 2 + PAGE.gapPx; // bottom margin + strip + top margin
export const PITCH = CONTENT_HEIGHT_PX + GAP;

export interface Spacer {
  index: number;
  height: number;
}

export function layoutPages(blocks: { top: number; bottom: number }[]): { spacers: Spacer[]; pages: number } {
  const spacers: Spacer[] = [];
  let shift = 0;
  let pageStart = 0;
  let bottom = 0;
  blocks.forEach((blk, index) => {
    let ts = blk.top + shift;
    let bs = blk.bottom + shift;
    while (ts >= pageStart + PITCH - 0.5) pageStart += PITCH;
    const pageEnd = pageStart + CONTENT_HEIGHT_PX;
    const push = () => {
      const add = pageStart + PITCH - ts;
      spacers.push({ index, height: Math.round(add * 100) / 100 });
      shift += add;
      ts += add;
      bs += add;
      pageStart += PITCH;
    };
    if (ts >= pageEnd - 0.5) push();
    else if (bs > pageEnd + 0.5 && blk.bottom - blk.top <= CONTENT_HEIGHT_PX + 0.5 && ts > pageStart + 0.5) push();
    bottom = bs;
  });
  if (!blocks.length) return { spacers, pages: 1 };
  let k = Math.floor((bottom - 0.5) / PITCH);
  if (bottom - k * PITCH > CONTENT_HEIGHT_PX + 0.5) k++;
  return { spacers, pages: Math.max(1, k + 1) };
}


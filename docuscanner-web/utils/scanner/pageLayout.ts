// How a scanner page is laid out on the sheet of the exported PDF. Pure maths, no DOM, so the PDF
// writer, the photo-size presets and the tests all use the same answer.
//
//  - A page that came from a PDF keeps its own physical size and orientation: the page image fills a
//    sheet exactly as big as the original page (so Letter stays Letter, a landscape page stays
//    landscape). Rotating or cropping it changes the shape of the sheet but never the scale.
//  - A scanned or uploaded picture has no physical size of its own, so it is fitted, centred and
//    never stretched, onto an A4 sheet whose orientation matches the picture (landscape pictures
//    get a landscape sheet instead of a small strip on a portrait one).

export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;
// PDF viewers cap a page at 200 inches.
const MAX_SHEET_PT = 14400;

export interface PageLayout {
  // The sheet (the PDF page) in points.
  sheetW: number;
  sheetH: number;
  // Where the page image sits on the sheet.
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: "portrait" | "landscape";
}

export function exportPageLayout(pageWidthPx: number, pageHeightPx: number, ptPerPx?: number): PageLayout {
  if (ptPerPx && ptPerPx > 0 && Number.isFinite(ptPerPx)) {
    let w = pageWidthPx * ptPerPx;
    let h = pageHeightPx * ptPerPx;
    const shrink = Math.min(1, MAX_SHEET_PT / Math.max(w, h));
    w *= shrink;
    h *= shrink;
    return { sheetW: w, sheetH: h, x: 0, y: 0, w, h, orientation: w > h ? "landscape" : "portrait" };
  }
  const landscape = pageWidthPx > pageHeightPx;
  const sheetW = landscape ? A4_HEIGHT_PT : A4_WIDTH_PT;
  const sheetH = landscape ? A4_WIDTH_PT : A4_HEIGHT_PT;
  const scale = Math.min(sheetW / pageWidthPx, sheetH / pageHeightPx);
  const w = pageWidthPx * scale;
  const h = pageHeightPx * scale;
  return { sheetW, sheetH, x: (sheetW - w) / 2, y: (sheetH - h) / 2, w, h, orientation: landscape ? "landscape" : "portrait" };
}

// Whether an imported PDF page can be exported by re-using the original PDF page (keeping its
// text, vectors and full quality) instead of a picture of it. Kept apart from pdfExport.ts on
// purpose: this check is needed on page load (printing, previews), while pdfExport.ts pulls in
// pdf-lib and its fonts (~230 KB compressed), which should only load when a PDF is being made.

import { flattenReason } from "./cropMath";
import type { ScannerPage } from "./page";
import { getSourcePdf } from "./sourcePdfs";

export function canPreserveSource(page: ScannerPage): boolean {
  return !!page.source && !!getSourcePdf(page.source.fileId) && flattenReason(page) === null;
}

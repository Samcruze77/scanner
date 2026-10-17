"use client";

// Says, for a page of an imported PDF, whether the exported PDF keeps its text and sharp lines, and when an
// edit means it cannot. Shown wherever the edit is made and next to the selected page. Uses the same rule
// as the exporter (utils/scanner/cropMath.ts), so what is said is what happens.

import { axisAlignedRect, flattenReason, type FlattenReason } from "@/utils/scanner/cropMath";
import { ENHANCEMENT_MODES } from "@/utils/scanner/enhance";
import type { ScannerPage } from "@/utils/scanner/page";

const PICTURE = "In the exported PDF this page becomes a picture, drawn from the original at about 300 dpi (lower on very large pages), so its text and lines can no longer be selected or searched. Your other pages are not affected.";

export function flattenMessage(page: ScannerPage, reason: FlattenReason): string {
  switch (reason) {
    case "enhancement": {
      const label = ENHANCEMENT_MODES.find((m) => m.value === page.enhancement)?.label ?? page.enhancement;
      return `${label} changes the colours of the page itself. ${PICTURE} Choose Original to keep the text.`;
    }
    case "adjustment":
      return `Brightness and contrast change the colours of the page itself. ${PICTURE} Set both back to 0 to keep the text.`;
    case "permanent-crop":
      return `You chose to remove the cut-away area for good. ${PICTURE} Crop again without that option to keep the text.`;
    case "skewed-crop":
      return `A slanted crop needs new pixels. ${PICTURE}`;
  }
}

// `before` adds a heads-up while nothing has been applied yet, so the person knows what Grayscale, Black & White,
// Auto, brightness and contrast will do before choosing them.
export function FlattenNotice({ page, className, before }: { page: ScannerPage; className?: string; before?: boolean }) {
  if (!page.source) return null;
  const reason = flattenReason(page);
  if (reason) {
    return (
      <p role="status" data-flatten-notice="picture" className={`notice notice-warning text-xs leading-5 ${className ?? ""}`}>
        {flattenMessage(page, reason)}
      </p>
    );
  }
  if (page.cropEnabled && page.quad && axisAlignedRect(page.quad)) {
    return (
      <p role="status" data-flatten-notice="kept" className={`muted text-xs leading-5 ${className ?? ""}`}>
        Cropped without flattening: the page keeps its selectable text. The area you cut away is hidden, but it is still inside the PDF file.
      </p>
    );
  }
  if (before) {
    return (
      <p data-flatten-notice="before" className={`muted text-xs leading-5 ${className ?? ""}`}>
        Heads-up: Grayscale, Black &amp; White, Auto, brightness and contrast change the colours of the page itself. Only this page then becomes a picture in the exported PDF (its text can no longer be selected); your other pages keep theirs. Reset to original brings it back.
      </p>
    );
  }
  return null;
}

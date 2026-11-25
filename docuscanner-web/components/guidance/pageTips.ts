// One short tip per tool page, shown by <PageTip> while Help tips is ON (approved wording, 2026-11-25).
// Every sentence describes what the tool really does; if a tool changes, change its tip too.
// Pages that share a tool share a tip (PDF to JPG / PNG; Compress Word / Excel), so closing it once
// closes it on both.

export const PAGE_TIPS = {
  "page-home":
    "New here? Choose Scan document to photograph paper pages, or Upload document for a PDF, Word, Excel or image file. Every other tool is under Convert and Tools at the top.",
  "page-pdf-to-word":
    "Text PDFs convert best. Scanned pages are read with English text recognition, so check the wording in Word; columns and exact spacing may need a little tidying.",
  "page-word-to-pdf":
    "Check the first-page preview before you share the PDF. If your document uses a less common font such as Aptos, upload its font file so lines break where they do in Word.",
  "page-excel-to-pdf":
    "Choose which sheets to include and the page orientation before you convert. Wide sheets are split across pages, so check the preview.",
  "page-pdf-to-excel":
    "PDFs with clear columns give the best tables. Scanned pages come out one line per row, so you may need to split columns in Excel.",
  "page-pdf-to-image":
    "Pick 300 DPI if you will print the images. To convert only some pages, choose Only these pages and type them, for example 1-3, 5.",
  "page-compress-pdf":
    "Move the slider and watch the estimated size; More options lets you aim for a size such as 1 MB. If the result wouldn't be smaller, you get your original back.",
  "page-compress-image":
    "Smaller files mean lower quality, so check the preview before you download. More options lets you aim for a target size or a smaller image size.",
  "page-compress-office":
    "Only the pictures inside are made smaller; your text and formatting stay exactly as they are. A file with few pictures will barely change.",
  "page-protect-pdf":
    "Keep your password somewhere safe: FreePDFScanner never sees it and can't recover it. Open the protected copy once to check the password before you share it.",
  "page-edit-image":
    "Crop, rotate, flip, resize or adjust, and undo any step. The download is made from your original pixels; choose PNG to keep it lossless.",
} as const;

export type PageTipId = keyof typeof PAGE_TIPS;

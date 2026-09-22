// The real, current set of pages a campaign can target -- taken directly
// from utils/tools/registry.ts (TOOLS) and the app/convert/* routes, not
// invented. Empty target_paths on a campaign means "entire site."

export const TARGETABLE_PATHS: { path: string; label: string }[] = [
  { path: "/", label: "Homepage" },
  { path: "/scan", label: "Scanner" },
  { path: "/tools", label: "Tools hub" },
  { path: "/convert", label: "Convert hub" },
  { path: "/guides", label: "Guides hub" },
  { path: "/convert/word-to-pdf", label: "Word to PDF" },
  { path: "/convert/pdf-to-word", label: "PDF to Word" },
  { path: "/convert/pdf-to-excel", label: "PDF to Excel" },
  { path: "/convert/excel-to-pdf", label: "Excel to PDF" },
  { path: "/convert/image-to-pdf", label: "Image to PDF" },
  { path: "/tools/pdf-editor", label: "PDF Editor" },
  { path: "/tools/annotate", label: "Annotate" },
  { path: "/tools/draw", label: "Draw" },
  { path: "/tools/highlight", label: "Highlight" },
  { path: "/tools/add-text", label: "Add Text" },
  { path: "/tools/add-date", label: "Add Date" },
  { path: "/tools/checkmark", label: "Checkmark" },
  { path: "/tools/x-mark", label: "X Mark" },
  { path: "/tools/sign-pdf", label: "Sign PDF" },
  { path: "/tools/add-signature", label: "Add Signature" },
  { path: "/tools/upload-signature", label: "Upload Signature" },
  { path: "/tools/ocr", label: "OCR: Extract Text" },
  { path: "/tools/compress-pdf", label: "Compress PDF" },
  { path: "/tools/compress-image", label: "Compress Image" },
  { path: "/tools/compress-word", label: "Compress Word" },
  { path: "/tools/compress-excel", label: "Compress Excel" },
];

export const AD_SLOTS: { code: "top" | "side" | "bottom" | "inline"; label: string; box: string }[] = [
  { code: "top", label: "Top banner", box: "Full-width, ~64–80px tall" },
  { code: "side", label: "Side rail (desktop, wide pages only)", box: "300×250" },
  { code: "bottom", label: "Bottom banner (every workspace/content page)", box: "Full-width, ~64–80px tall" },
  { code: "inline", label: "Inline (reserved, not yet placed on any page)", box: "Full-width, ~80–96px tall" },
];

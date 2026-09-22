// The Tools menu, described once: the hub page, each tool's page, the metadata
// and the login rules all read from here so they can't drift apart.
//
// Two separate ideas live here on purpose:
//  - `feature` points into the plan registry (utils/features/plans.ts). That is
//    the ONLY place plans/premium are decided. Every tool below is free.
//  - `requiresAuth` is a plain login requirement ("sign in or create a free
//    account"). It has nothing to do with plans. Nothing requires it today:
//    signing has always worked for guests, so it stays that way. Flip a tool's
//    flag to ask guests to log in first; the prompt and analytics are already
//    wired (see components/tools/ToolGate.tsx).

import type { AnnotationTool } from "@/utils/scanner/annotations";
import type { FeatureId } from "@/utils/features/plans";

export type ToolGroupId = "edit-sign" | "text" | "compress";
export type CompressKind = "pdf" | "image" | "word" | "excel";

interface ToolBase {
  id: string; // used in analytics; no user data
  slug: string;
  title: string;
  body: string;
  group: ToolGroupId;
  feature: FeatureId;
  requiresAuth: boolean;
}

export interface EditorTool extends ToolBase {
  kind: "editor";
  // Which annotation tool the editor opens with, and (for signatures) which
  // method starts selected.
  editor: { tool: AnnotationTool | null; signatureTab?: "draw" | "upload" };
  // Shown above the workspace: what to do first.
  guide: string;
}

export interface CompressTool extends ToolBase {
  kind: "compress";
  compress: CompressKind;
}

export type ToolDef = EditorTool | CompressTool;

export const TOOL_GROUPS: { id: ToolGroupId; title: string; body: string }[] = [
  { id: "edit-sign", title: "Edit & Sign", body: "Add text, marks and your signature to a document." },
  { id: "text", title: "Extract text", body: "Read the words from scans and photos with OCR." },
  { id: "compress", title: "Compress", body: "Make files smaller so they are easier to send." },
];

const editor = (
  slug: string,
  title: string,
  body: string,
  tool: AnnotationTool | null,
  guide: string,
  feature: FeatureId = "edit.annotate",
  signatureTab?: "draw" | "upload",
): EditorTool => ({
  id: slug.replace(/-/g, "_"),
  slug,
  title,
  body,
  group: "edit-sign",
  kind: "editor",
  feature,
  requiresAuth: false,
  editor: { tool, signatureTab },
  guide,
});

const compress = (slug: string, title: string, body: string, kind: CompressKind, feature: FeatureId): CompressTool => ({
  id: slug.replace(/-/g, "_"),
  slug,
  title,
  body,
  group: "compress",
  kind: "compress",
  compress: kind,
  feature,
  requiresAuth: false,
});

export const TOOLS: ToolDef[] = [
  editor("pdf-editor", "PDF Editor", "Crop, enhance, reorder pages, add text and sign, then save one clean PDF.", null, "Upload a PDF or image, tap a page to open the editor, then choose what to add."),
  editor("add-text", "Add Text", "Type text anywhere on a page and choose its size, colour and style.", "text", "Upload a document, tap a page, then tap where you want to type."),
  editor("annotate", "Annotate", "Text, drawing, highlights, check marks, X marks, dates and signatures in one place.", "select", "Upload a document, tap a page, then choose a tool along the top."),
  editor("draw", "Draw", "Draw freehand on a page with your finger or mouse.", "draw", "Upload a document, tap a page, then draw where you like."),
  editor("highlight", "Highlight", "Drag across text or an area to highlight it.", "highlight", "Upload a document, tap a page, then drag across what to highlight."),
  editor("add-date", "Add Date", "Place today's date on a page, then edit, move or resize it.", "date", "Upload a document, tap a page, then tap where the date should go."),
  editor("checkmark", "Checkmark", "Place check marks on forms and lists.", "check", "Upload a document, tap a page, then tap to place check marks."),
  editor("x-mark", "X Mark", "Place X marks to cross things out or tick boxes.", "cross", "Upload a document, tap a page, then tap to place X marks."),
  editor("sign-pdf", "Sign PDF", "Sign a PDF with a drawn or uploaded signature. Free, no account needed.", "signature", "Upload your PDF, tap the page to sign, then draw your signature or upload an image of it.", "edit.sign"),
  editor("add-signature", "Add Signature", "Draw your signature and place it on any document.", "signature", "Upload a document, tap a page, then draw your signature and drag it into place.", "edit.sign", "draw"),
  editor("upload-signature", "Upload Signature", "Use a picture of your signature. PNG keeps its transparent background.", "signature", "Upload a document, tap a page, then choose an image of your signature.", "edit.sign", "upload"),
  // Text recognition (OCR) reads a scanned PDF or photo and shows the text to copy. It is the
  // scanner workspace, opened on Upload, with the "Extract text" step explained.
  {
    ...editor(
      "ocr",
      "OCR: Extract Text",
      "Read text from scanned PDFs and photos with free OCR that runs in your browser.",
      null,
      "Upload a scanned PDF or a photo, open More options, then choose Extract text.",
      "ocr.basic",
    ),
    group: "text" as const,
  },
  compress("compress-pdf", "Compress PDF", "Shrink a PDF with a quality-to-size slider, keeping text readable.", "pdf", "compress.pdf"),
  compress("compress-image", "Compress Image", "Reduce a photo's file size with a quality-to-size slider.", "image", "compress.image"),
  compress("compress-word", "Compress Word", "Shrink the pictures inside a Word document without touching its layout.", "word", "compress.word"),
  compress("compress-excel", "Compress Excel", "Shrink the pictures inside a workbook. Formulas, sheets and formatting stay as they are.", "excel", "compress.excel"),
];

export function getToolBySlug(slug: string): ToolDef | undefined {
  return TOOLS.find((t) => t.slug === slug);
}

export function toolsInGroup(group: ToolGroupId): ToolDef[] {
  return TOOLS.filter((t) => t.group === group);
}

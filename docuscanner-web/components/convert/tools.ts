// The app's tools, described once so the home page, the tools hub and the
// header navigation can't drift apart.

export interface ToolLink {
  href: string;
  title: string;
  body: string;
}

export const SCAN_TOOL: ToolLink = {
  href: "/scan",
  title: "Scan, edit & sign",
  body: "Scan with your camera or upload a PDF, Word, Excel, CSV or image. Crop and enhance pages, add text and your signature, then export one clean PDF.",
};

export const CONVERT_TOOLS: ToolLink[] = [
  {
    href: "/convert/image-to-pdf",
    title: "Image to PDF",
    body: "Turn photos and pictures into one PDF. Crop, enhance and reorder the pages first.",
  },
  {
    href: "/convert/word-to-pdf",
    title: "Word to PDF",
    body: "Turn a Word document into a PDF that keeps your fonts, spacing, margins, tables, pictures, headers and footers.",
  },
  {
    href: "/convert/pdf-to-word",
    title: "PDF to Word",
    body: "Get an editable Word document from a PDF. Scanned pages are read with text recognition.",
  },
  {
    href: "/convert/excel-to-pdf",
    title: "Excel to PDF",
    body: "Turn a spreadsheet into a tidy, paginated PDF. Keeps values, fonts, colours, borders and merged cells.",
  },
  {
    href: "/convert/pdf-to-excel",
    title: "PDF to Excel",
    body: "Pull tables out of a PDF into a real spreadsheet, with numbers you can add up. Scanned pages are read with text recognition.",
  },
];

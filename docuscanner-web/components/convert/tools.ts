// The app's tools, described once so the home page, the tools hub and the
// header navigation can't drift apart.

export interface ToolLink {
  href: string;
  title: string;
  body: string;
}

export const SCAN_TOOL: ToolLink = {
  href: "/scan",
  title: "Scan to PDF",
  body: "Scan with your camera or upload photos and PDFs. Crop, straighten and enhance each page, then export one clean PDF.",
};

export const CONVERT_TOOLS: ToolLink[] = [
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

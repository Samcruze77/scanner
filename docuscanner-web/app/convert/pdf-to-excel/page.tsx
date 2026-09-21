import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { PdfToExcelTool } from "@/components/convert/PdfToExcelTool";

export const metadata: Metadata = {
  title: "PDF to Excel converter - PDFScanner",
  description:
    "Convert PDF tables to an Excel spreadsheet for free, right in your browser. Your file never leaves your device.",
};

export default function PdfToExcelPage() {
  return (
    <PageShell width="narrow" ads="workflow">
      <PageHeader title="PDF to Excel">
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </PageHeader>
      <PdfToExcelTool />
    </PageShell>
  );
}

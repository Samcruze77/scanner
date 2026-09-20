import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { PdfToExcelTool } from "@/components/convert/PdfToExcelTool";

export const metadata: Metadata = {
  title: "PDF to Excel converter - DocuScanner",
  description:
    "Convert PDF tables to an Excel spreadsheet for free, right in your browser. Your file never leaves your device.",
};

export default function PdfToExcelPage() {
  return (
    <PageShell>
      <h1 className="mb-1 text-xl font-semibold">PDF to Excel</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </p>
      <PdfToExcelTool />
    </PageShell>
  );
}

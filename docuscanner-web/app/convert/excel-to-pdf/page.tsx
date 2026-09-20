import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { ExcelToPdfTool } from "@/components/convert/ExcelToPdfTool";

export const metadata: Metadata = {
  title: "Excel to PDF converter - DocuScanner",
  description:
    "Convert Excel and CSV files to PDF for free, right in your browser. Your file never leaves your device.",
};

export default function ExcelToPdfPage() {
  return (
    <PageShell>
      <h1 className="mb-1 text-xl font-semibold">Excel to PDF</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </p>
      <ExcelToPdfTool />
    </PageShell>
  );
}

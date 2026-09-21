import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ExcelToPdfTool } from "@/components/convert/ExcelToPdfTool";

export const metadata: Metadata = {
  title: "Excel to PDF converter - DocuScanner",
  description:
    "Convert Excel and CSV files to PDF for free, right in your browser. Your file never leaves your device.",
};

export default function ExcelToPdfPage() {
  return (
    <PageShell width="narrow" ads="workflow">
      <PageHeader title="Excel to PDF">
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </PageHeader>
      <ExcelToPdfTool />
    </PageShell>
  );
}

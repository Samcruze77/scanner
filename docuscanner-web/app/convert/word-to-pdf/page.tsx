import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { WordToPdfTool } from "@/components/convert/WordToPdfTool";

export const metadata: Metadata = {
  title: "Word to PDF converter - DocuScanner",
  description:
    "Convert Word (.docx) documents to PDF for free, right in your browser. Your file never leaves your device.",
};

export default function WordToPdfPage() {
  return (
    <PageShell width="narrow" ads="workflow">
      <PageHeader title="Word to PDF">
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </PageHeader>
      <WordToPdfTool />
    </PageShell>
  );
}

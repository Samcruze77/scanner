import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { WordToPdfTool } from "@/components/convert/WordToPdfTool";

export const metadata: Metadata = {
  title: "Word to PDF converter - DocuScanner",
  description:
    "Convert Word (.docx) documents to PDF for free, right in your browser. Your file never leaves your device.",
};

export default function WordToPdfPage() {
  return (
    <PageShell>
      <h1 className="mb-1 text-xl font-semibold">Word to PDF</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </p>
      <WordToPdfTool />
    </PageShell>
  );
}

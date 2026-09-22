import type { Metadata } from "next";
import { ScannerWorkspace } from "@/components/scanner/ScannerWorkspace";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { graph, webApplicationSchema, webPageSchema } from "@/utils/seo/schema";

// getLanding("/scan") always resolves (see utils/seo/landing.ts); the `!` documents that
// rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/scan")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/scan",
});

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const initialMode = mode === "camera" || mode === "upload" ? mode : undefined;

  return (
    <PageShell width="workspace" ads="workflow">
      <JsonLd data={graph(webApplicationSchema("/scan", landing.appName, landing.description, landing.features), webPageSchema("/scan", landing.h1, landing.description))} />
      <PageHeader title={landing.h1}>
        Free to use as a guest, and everything happens in your browser. Sign in if you&apos;d like to save a document to your account.
      </PageHeader>
      <ScannerWorkspace initialMode={initialMode} />
      <SeoContent page={landing} />
    </PageShell>
  );
}

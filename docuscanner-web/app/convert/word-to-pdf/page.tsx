import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { WordToPdfTool } from "@/components/convert/WordToPdfTool";

import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { graph, webApplicationSchema, webPageSchema } from "@/utils/seo/schema";

// getLanding("/convert/word-to-pdf") always resolves (see utils/seo/landing.ts); the `!`
// documents that rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/convert/word-to-pdf")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/convert/word-to-pdf",
});

export default function WordToPdfPage() {
  return (
    <PageShell width="narrow" ads="workflow">
      <JsonLd data={graph(webApplicationSchema("/convert/word-to-pdf", landing.appName, landing.description, landing.features), webPageSchema("/convert/word-to-pdf", landing.h1, landing.description))} />
      <PageHeader title={landing.h1}>
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </PageHeader>
      <WordToPdfTool />
      <SeoContent page={landing} />
    </PageShell>
  );
}

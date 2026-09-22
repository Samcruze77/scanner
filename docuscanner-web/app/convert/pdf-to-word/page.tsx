import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { PdfToWordTool } from "@/components/convert/PdfToWordTool";

import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { graph, webApplicationSchema, webPageSchema } from "@/utils/seo/schema";

// getLanding("/convert/pdf-to-word") always resolves (see utils/seo/landing.ts); the `!`
// documents that rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/convert/pdf-to-word")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/convert/pdf-to-word",
});

export default function PdfToWordPage() {
  return (
    <PageShell width="narrow" ads="workflow">
      <JsonLd data={graph(webApplicationSchema("/convert/pdf-to-word", landing.appName, landing.description, landing.features), webPageSchema("/convert/pdf-to-word", landing.h1, landing.description))} />
      <PageHeader title={landing.h1}>
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </PageHeader>
      <PdfToWordTool />
      <SeoContent page={landing} />
    </PageShell>
  );
}

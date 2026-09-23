import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { ToolCta } from "@/components/seo/ToolCta";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

// getLanding("/pdf-to-text") always resolves (see utils/seo/landing.ts); the `!`
// documents that rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/pdf-to-text")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/pdf-to-text",
});

// TXT export lives in the scanner's own Export menu (/scan) -- this page is
// a keyword-specific entry point into it, not a separate converter.
export default function PdfToTextPage() {
  return (
    <PageShell>
      <JsonLd
        data={graph(
          webPageSchema("/pdf-to-text", landing.h1, landing.description),
          breadcrumbSchema("/pdf-to-text", landing.crumbs),
        )}
      />
      <PageHeader title={landing.h1}>{landing.intro}</PageHeader>
      <ToolCta href="/scan" label="Open the scanner" />
      <SeoContent page={landing} />
    </PageShell>
  );
}

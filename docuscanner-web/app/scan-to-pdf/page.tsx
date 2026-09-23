import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { ToolCta } from "@/components/seo/ToolCta";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

// getLanding("/scan-to-pdf") always resolves (see utils/seo/landing.ts); the `!`
// documents that rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/scan-to-pdf")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/scan-to-pdf",
});

// The actual scanner lives at /scan (its own full landing+tool page) -- this
// page is a keyword-specific entry point into it, not a second scanner.
export default function ScanToPdfPage() {
  return (
    <PageShell>
      <JsonLd
        data={graph(
          webPageSchema("/scan-to-pdf", landing.h1, landing.description),
          breadcrumbSchema("/scan-to-pdf", landing.crumbs),
        )}
      />
      <PageHeader title={landing.h1}>{landing.intro}</PageHeader>
      <ToolCta href="/scan" label="Open the scanner" />
      <SeoContent page={landing} />
    </PageShell>
  );
}

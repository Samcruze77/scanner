import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { ToolCta } from "@/components/seo/ToolCta";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

// getLanding("/pdf-converter") always resolves (see utils/seo/landing.ts); the `!`
// documents that rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/pdf-converter")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/pdf-converter",
});

// This is a keyword-specific entry point into the real /convert hub and its
// individual converters (linked below via "related") -- not a new converter.
export default function PdfConverterPage() {
  return (
    <PageShell>
      <JsonLd
        data={graph(
          webPageSchema("/pdf-converter", landing.h1, landing.description),
          breadcrumbSchema("/pdf-converter", landing.crumbs),
        )}
      />
      <PageHeader title={landing.h1}>{landing.intro}</PageHeader>
      <ToolCta href="/convert" label="See all PDF converters" />
      <SeoContent page={landing} />
    </PageShell>
  );
}

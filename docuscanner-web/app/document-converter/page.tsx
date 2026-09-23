import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { ToolCta } from "@/components/seo/ToolCta";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

// getLanding("/document-converter") always resolves (see utils/seo/landing.ts);
// the `!` documents that rather than adding a runtime check for a case that
// can't happen.
const landing = getLanding("/document-converter")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/document-converter",
});

// This is a keyword-specific entry point into the real /convert hub, /scan,
// and the individual converters (linked below via "related") -- not a new
// converter.
export default function DocumentConverterPage() {
  return (
    <PageShell>
      <JsonLd
        data={graph(
          webPageSchema("/document-converter", landing.h1, landing.description),
          breadcrumbSchema("/document-converter", landing.crumbs),
        )}
      />
      <PageHeader title={landing.h1}>{landing.intro}</PageHeader>
      <ToolCta href="/convert" label="See all document converters" />
      <SeoContent page={landing} />
    </PageShell>
  );
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { ToolCta } from "@/components/seo/ToolCta";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

// getLanding("/png-to-pdf") always resolves (see utils/seo/landing.ts); the `!`
// documents that rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/png-to-pdf")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/png-to-pdf",
});

// The actual PNG-to-PDF functionality lives at /convert/image-to-pdf (which
// also accepts JPG and other image types) -- this page is a keyword-specific
// entry point into it, not a second copy of the tool.
export default function PngToPdfPage() {
  return (
    <PageShell>
      <JsonLd
        data={graph(
          webPageSchema("/png-to-pdf", landing.h1, landing.description),
          breadcrumbSchema("/png-to-pdf", landing.crumbs),
        )}
      />
      <PageHeader title={landing.h1}>{landing.intro}</PageHeader>
      <ToolCta href="/convert/image-to-pdf" label="Open the PNG to PDF tool" />
      <SeoContent page={landing} />
    </PageShell>
  );
}

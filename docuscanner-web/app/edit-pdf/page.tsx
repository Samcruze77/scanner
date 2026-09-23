import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { ToolCta } from "@/components/seo/ToolCta";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

// getLanding("/edit-pdf") always resolves (see utils/seo/landing.ts); the `!`
// documents that rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/edit-pdf")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/edit-pdf",
});

// The actual PDF editor lives at /tools/pdf-editor -- this page is a
// keyword-specific entry point into it, not a second copy of the tool.
export default function EditPdfPage() {
  return (
    <PageShell>
      <JsonLd
        data={graph(
          webPageSchema("/edit-pdf", landing.h1, landing.description),
          breadcrumbSchema("/edit-pdf", landing.crumbs),
        )}
      />
      <PageHeader title={landing.h1}>{landing.intro}</PageHeader>
      <ToolCta href="/tools/pdf-editor" label="Open the PDF editor" />
      <SeoContent page={landing} />
    </PageShell>
  );
}

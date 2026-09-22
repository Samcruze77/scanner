import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ExcelToPdfTool } from "@/components/convert/ExcelToPdfTool";

import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { graph, webApplicationSchema, webPageSchema } from "@/utils/seo/schema";

// getLanding("/convert/excel-to-pdf") always resolves (see utils/seo/landing.ts); the `!`
// documents that rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/convert/excel-to-pdf")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/convert/excel-to-pdf",
});

export default function ExcelToPdfPage() {
  return (
    <PageShell width="narrow" ads="workflow">
      <JsonLd data={graph(webApplicationSchema("/convert/excel-to-pdf", landing.appName, landing.description, landing.features), webPageSchema("/convert/excel-to-pdf", landing.h1, landing.description))} />
      <PageHeader title={landing.h1}>
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </PageHeader>
      <ExcelToPdfTool />
      <SeoContent page={landing} />
    </PageShell>
  );
}

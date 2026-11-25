import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { PageTip } from "@/components/guidance/PageTip";
import { PdfToImageTool } from "@/components/convert/PdfToImageTool";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { graph, webApplicationSchema, webPageSchema } from "@/utils/seo/schema";

// getLanding("/convert/pdf-to-png") always resolves (see utils/seo/landing.ts).
const landing = getLanding("/convert/pdf-to-png")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  description: landing.description,
  path: "/convert/pdf-to-png",
});

// The same converter as /convert/pdf-to-jpg, opened with PNG chosen: the two pages answer
// different searches and each explains its own format (see utils/seo/landing.ts).
export default function PdfToPngPage() {
  return (
    <PageShell width="narrow" ads="workflow">
      <JsonLd
        data={graph(
          webApplicationSchema("/convert/pdf-to-png", landing.appName, landing.description, landing.features),
          webPageSchema("/convert/pdf-to-png", landing.h1, landing.description, false),
        )}
      />
      <PageHeader title={landing.h1}>{landing.intro}</PageHeader>
      <PageTip id="page-pdf-to-image" className="mb-4" />
      <PdfToImageTool defaultFormat="png" />
      <SeoContent page={landing} />
    </PageShell>
  );
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ScannerWorkspace } from "@/components/scanner/ScannerWorkspace";

import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { graph, webApplicationSchema, webPageSchema } from "@/utils/seo/schema";

// getLanding("/convert/image-to-pdf") always resolves (see utils/seo/landing.ts); the `!`
// documents that rather than adding a runtime check for a case that can't happen.
const landing = getLanding("/convert/image-to-pdf")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - PDFScanner`,
  description: landing.description,
  path: "/convert/image-to-pdf",
});

export default function ImageToPdfPage() {
  return (
    <PageShell width="workspace" ads="workflow">
      <JsonLd data={graph(webApplicationSchema("/convert/image-to-pdf", landing.appName, landing.description, landing.features), webPageSchema("/convert/image-to-pdf", landing.h1, landing.description))} />
      <PageHeader title={landing.h1}>
        Add one or more pictures, crop and reorder them, then create one PDF. Free, no account needed. Your pictures stay on your device.
      </PageHeader>
      <ScannerWorkspace />
      <SeoContent page={landing} />
    </PageShell>
  );
}

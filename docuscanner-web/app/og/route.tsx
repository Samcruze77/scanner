// The branded 1200x630 social-share image: the FreePDFScanner logo (public/brand/logo-full.png)
// on its own black background, with the site description beneath. Referenced by
// utils/seo/metadata.ts as every page's Open Graph / Twitter image, and used as the root
// layout's default too.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION } from "@/utils/seo/site";

// The image is the same for every request, so this can be generated once at build time
// rather than on the (deprecated) edge runtime per request.
export const dynamic = "force-static";

export async function GET() {
  const file = await readFile(path.join(process.cwd(), "public", "brand", "logo-full.png"));
  const logo = `data:image/png;base64,${file.toString("base64")}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#000000",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered by satori, not the browser */}
        <img src={logo} alt="" width={420} height={340} />
        <span style={{ marginTop: 20, fontSize: 28, color: "#d4d4d8", maxWidth: 960, textAlign: "center" }}>{SITE_DESCRIPTION}</span>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}

// The branded 1200x630 social-share image, generated from the same mark and name as the
// header (no separate design asset to keep in sync). Referenced by utils/seo/metadata.ts
// as every page's Open Graph / Twitter image, and used as the root layout's default too.

import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME } from "@/utils/seo/site";

// The image is the same for every request, so this can be generated once at build time
// rather than on the (deprecated) edge runtime per request.
export const dynamic = "force-static";

export function GET() {
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
          background: "#fafafa",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 96,
              height: 96,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#155DFC",
              borderRadius: 22,
            }}
          >
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3h7l5 5v13H7z" />
              <path d="M10 13h6M10 17h6" />
            </svg>
          </div>
          <span style={{ fontSize: 76, fontWeight: 700, color: "#18181b", letterSpacing: -1 }}>{SITE_NAME}</span>
        </div>
        <span style={{ marginTop: 28, fontSize: 30, color: "#52525b", maxWidth: 900, textAlign: "center" }}>{SITE_DESCRIPTION}</span>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}

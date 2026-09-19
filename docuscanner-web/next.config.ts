import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Multiple package-lock.json files exist above this directory
    // (C:\Users\ADMIN and C:\Users\ADMIN\Documents\scanner), which makes
    // Next.js infer the wrong workspace root. Pin it explicitly.
    root: path.join(__dirname),
  },
  async headers() {
    return [
      {
        // Self-hosted OCR runtime (see scripts/copy-ocr-assets.mjs). Multi-MB
        // and unchanged between deploys, so let browsers reuse it instead of
        // revalidating on every OCR run.
        source: "/ocr/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
      },
    ];
  },
};

export default nextConfig;

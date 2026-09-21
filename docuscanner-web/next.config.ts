import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Multiple package-lock.json files exist above this directory
    // (C:\Users\ADMIN and C:\Users\ADMIN\Documents\scanner), which makes
    // Next.js infer the wrong workspace root. Pin it explicitly.
    root: path.join(__dirname),
  },
  experimental: {
    // Since Next 16.3 Turbopack caches build work in .next/cache, and Vercel restores
    // that folder between deployments. The cached stylesheet was reused after
    // app/globals.css (and the classes used across the app) had changed, so production
    // shipped NEW pages with the PREVIOUS stylesheet: the theme rules were missing and
    // the middle theme never appeared. A clean build of the same commit was correct.
    // Compiling the stylesheet fresh on every build costs a few seconds and removes the
    // risk. (scripts/verify-theme-css.mjs also checks the result after every build.)
    turbopackFileSystemCacheForBuild: false,
  },
  async headers() {
    return [
      {
        // Self-hosted Word -> PDF fonts (see scripts/copy-font-assets.mjs): loaded
        // only when a Word file is converted, and unchanged between deploys.
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
      },
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

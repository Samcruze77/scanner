import type { NextConfig } from "next";
import path from "path";
import { FEATURES } from "./utils/features/plans";

const nextConfig: NextConfig = {
  turbopack: {
    // Multiple package-lock.json files exist above this directory
    // (C:\Users\ADMIN and C:\Users\ADMIN\Documents\scanner), which makes
    // Next.js infer the wrong workspace root. Pin it explicitly.
    root: path.join(__dirname),
    // The QPDF WebAssembly engine (Protect PDF) also ships Node code paths that require
    // these built-ins. They are never reached in a browser; give the bundler an empty stand-in.
    resolveAlias: {
      fs: { browser: "./utils/protect/emptyModule.ts" },
      path: { browser: "./utils/protect/emptyModule.ts" },
      crypto: { browser: "./utils/protect/emptyModule.ts" },
    },
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
  async redirects() {
    return [
      // Short, direct-match SEO aliases into the real (already fully-built)
      // tool pages -- permanent, since the target never changes and this
      // avoids duplicate-content pages for the exact same functionality.
      { source: "/pdf-to-word", destination: "/convert/pdf-to-word", permanent: true },
      { source: "/pdf-to-excel", destination: "/convert/pdf-to-excel", permanent: true },
      { source: "/word-to-pdf", destination: "/convert/word-to-pdf", permanent: true },
      { source: "/image-to-pdf", destination: "/convert/image-to-pdf", permanent: true },
      { source: "/compress-pdf", destination: "/tools/compress-pdf", permanent: true },
      { source: "/ocr", destination: "/tools/ocr", permanent: true },
      { source: "/protect-pdf", destination: "/tools/protect-pdf", permanent: true },
      { source: "/lock-pdf", destination: "/tools/protect-pdf", permanent: true },
      { source: "/password-protect-pdf", destination: "/tools/protect-pdf", permanent: true },
      // The Word pages only exist while the Word option is on (utils/features/plans.ts).
      ...(FEATURES["protect.docx"].implemented
        ? [
            { source: "/protect-word-document", destination: "/tools/protect-word", permanent: true },
            { source: "/password-protect-word-document", destination: "/tools/protect-word", permanent: true },
            { source: "/protect-excel", destination: "/tools/protect-excel", permanent: true },
            { source: "/password-protect-excel", destination: "/tools/protect-excel", permanent: true },
            { source: "/protect-powerpoint", destination: "/tools/protect-powerpoint", permanent: true },
            { source: "/password-protect-powerpoint", destination: "/tools/protect-powerpoint", permanent: true },
          ]
        : []),
    ];
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
        // Self-hosted PDF protection engine (see scripts/copy-qpdf-assets.mjs): loaded
        // only when a PDF is protected, and unchanged between deploys.
        source: "/qpdf/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
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

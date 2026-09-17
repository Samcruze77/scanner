import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Multiple package-lock.json files exist above this directory
    // (C:\Users\ADMIN and C:\Users\ADMIN\Documents\scanner), which makes
    // Next.js infer the wrong workspace root. Pin it explicitly.
    root: path.join(__dirname),
  },
};

export default nextConfig;

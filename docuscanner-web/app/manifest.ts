// The web app manifest (served at /manifest.webmanifest). Lets a phone offer "Add to
// Home Screen" with the right name and colour, and gives search engines and browsers a
// standard place to read the site's identity. This is a document scanner used in a
// browser tab and can also be installed so it opens in its own window; it has no service worker and
// does not claim to work offline.

import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/utils/seo/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} - Free document scanning`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#155DFC",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

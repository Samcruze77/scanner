// The web app manifest (served at /manifest.webmanifest). Lets a phone offer "Add to
// Home Screen" with the right name and colour, and gives search engines and browsers a
// standard place to read the site's identity. This is a document scanner used in a
// browser tab, not an installed app, so `display` is "browser" rather than "standalone".

import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/utils/seo/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} - Free document scanning`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "browser",
    background_color: "#fafafa",
    theme_color: "#155DFC",
    icons: [{ src: "/icon", sizes: "64x64", type: "image/png" }],
  };
}

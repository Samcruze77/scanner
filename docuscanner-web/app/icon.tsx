// Generates the browser-tab favicon and app icon from the same mark used in the header
// (components/layout/Logo.tsx), so the two never drift apart. Next.js serves this at
// /icon and wires it into every page's <link rel="icon"> automatically.

import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#155DFC",
          borderRadius: 14,
        }}
      >
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M10 13h6M10 17h6" />
        </svg>
      </div>
    ),
    { ...size },
  );
}

// The product's icons: one consistent set (24px grid, 1.75px round stroke, drawn in
// currentColor) that replaces emoji and text glyphs, which look different on every
// platform. Icons are decoration: put the meaning in the button's text or aria-label.
//
//   <Icon name="download" />             20px by default
//   <Icon name="camera" size={24} />

import type { ReactNode } from "react";

const ICONS = {
  home: (
    <>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v10h13V10" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3.2L8.7 5.5h6.6L16.8 8H20v11H4z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4.5" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11.5" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  document: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
    </>
  ),
  documents: (
    <>
      <path d="M9 7h7l4 4v10H9z" />
      <path d="M16 7v4h4" />
      <path d="M6 17H4V3h8v2" />
    </>
  ),
  convert: (
    <>
      <path d="M4 8h13" />
      <path d="M14 4.5 17.5 8 14 11.5" />
      <path d="M20 16H7" />
      <path d="M10 12.5 6.5 16 10 19.5" />
    </>
  ),
  tools: (
    <>
      <path d="M4 7h9" />
      <path d="M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 17h3" />
      <path d="M11 17h9" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c.6-3.6 3.6-5.5 7.5-5.5s6.9 1.9 7.5 5.5" />
    </>
  ),
  print: (
    <>
      <path d="M7 8V3.5h10V8" />
      <path d="M7 17H4V9.5h16V17h-3" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h7V4" />
      <path d="M8 20v-6h8v6" />
    </>
  ),
  crop: (
    <>
      <path d="M6 3v15h15" />
      <path d="M3 6h15v15" />
    </>
  ),
  "rotate-left": (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 3.5V8.5H9" />
    </>
  ),
  "rotate-right": (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 3.5V8.5H15" />
    </>
  ),
  enhance: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
    </>
  ),
  text: (
    <>
      <path d="M5 6.5V4.5h14v2" />
      <path d="M12 4.5v15" />
      <path d="M9 19.5h6" />
    </>
  ),
  pen: (
    <>
      <path d="M4 20l4.2-1L19 8.2 15.8 5 5 15.8z" />
      <path d="M14 6.8l3.2 3.2" />
    </>
  ),
  highlight: (
    <>
      <path d="M4 20h16" />
      <path d="M8 16l-1 3 3-1 9-9-2-2z" />
    </>
  ),
  signature: (
    <>
      <path d="M3 16.5c2.6-5.5 4.6-8 5.8-8 1.4 0 .1 6.5 1.6 6.5s2-4.5 3.7-4.5c1.2 0 .6 3.5 2 3.5 1 0 1.6-.9 2.6-1.8" />
      <path d="M3 20.5h18" />
    </>
  ),
  compress: (
    <>
      <path d="M4 14h6v6" />
      <path d="M20 10h-6V4" />
      <path d="M10 14l-7 7" />
      <path d="M14 10l7-7" />
    </>
  ),
  ocr: (
    <>
      <path d="M4 8V4.5h3.5M16.5 4.5H20V8M20 16v3.5h-3.5M7.5 19.5H4V16" />
      <path d="M8 9.5h8M8 12.5h8M8 15.5h5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
  // Half filled circle: the middle theme.
  contrast: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 15.5H3z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </>
  ),
  pointer: <path d="M5 3.5l14 8-6 1.6L10 19.5z" />,
  undo: (
    <>
      <path d="M9 8h6a5 5 0 0 1 0 10H8" />
      <path d="M12 4.5L8.5 8 12 11.5" />
    </>
  ),
  redo: (
    <>
      <path d="M15 8H9a5 5 0 0 0 0 10h7" />
      <path d="M12 4.5L15.5 8 12 11.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  check: <path d="M5 12.5l4.8 4.8L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  "arrow-up": (
    <>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </>
  ),
  "arrow-down": (
    <>
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  "chevron-left": <path d="M15 5l-7 7 7 7" />,
  "chevron-right": <path d="M9 5l7 7-7 7" />,
  "chevron-down": <path d="M5 9l7 7 7-7" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4h5v3" />
      <path d="M6.2 7l.9 13h9.8l.9-13" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7.5 2.8v6c0 4.7-3.2 7.9-7.5 9.2-4.3-1.3-7.5-4.5-7.5-9.2v-6z" />
      <path d="M8.8 12l2.4 2.4 4-4.4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.9" r="0.6" fill="currentColor" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-4.5 3.5 3L15 13l5 4.5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4l9 4.5-9 4.5-9-4.5z" />
      <path d="M3 12.5l9 4.5 9-4.5" />
      <path d="M3 16.5l9 4.5 9-4.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ""}`}
    >
      {ICONS[name]}
    </svg>
  );
}

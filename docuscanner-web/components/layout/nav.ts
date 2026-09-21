// The product's top-level places, described once so the header, the phone bottom
// bar and the home page can't drift apart. Organised by what people come to do:
//   Scan     add pages, edit and sign them, create a PDF
//   Convert  change a file's type (Word, Excel, PDF, images)
//   Tools    sign and mark up documents, and make files smaller
//   History  documents saved to an account
import type { IconName } from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/scan", label: "Scan", icon: "camera" },
  { href: "/convert", label: "Convert", icon: "convert" },
  { href: "/tools", label: "Tools", icon: "tools" },
  { href: "/history", label: "History", icon: "history" },
];

// Convert and Tools each cover their hub and every page beneath it.
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

import Link from "next/link";
import { Icon } from "@/components/ui/icons";

// The prominent "go use it" button on a keyword-specific landing page whose
// real functionality lives on a different route (e.g. /jpg-to-pdf points at
// the actual tool at /convert/image-to-pdf) -- so the page reads as content
// leading somewhere real, not a dead end or a duplicate tool instance.
export function ToolCta({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="btn btn-primary btn-lg mt-6 inline-flex w-full items-center justify-center gap-2 sm:w-auto">
      {label}
      <Icon name="chevron-right" size={18} />
    </Link>
  );
}

"use client";

// Bottom navigation for phones: the same places as the header, within thumb reach
// (the header's links are hidden below `sm`). Fixed to the bottom, so app/layout.tsx
// reserves matching padding on <body> and nothing is covered. Signing in lives in the
// header on every screen size, so it isn't repeated here.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavActive } from "@/components/layout/nav";
import { Icon } from "@/components/ui/icons";

const ITEMS = [{ href: "/", label: "Home", icon: "home" as const }, ...NAV_ITEMS];

export function MobileActionBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-200 bg-chrome/95 backdrop-blur dark:border-zinc-800 sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : isNavActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              active ? "text-blue-700 dark:text-blue-400" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {active && <span aria-hidden className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-blue-600 dark:bg-blue-400" />}
            <Icon name={item.icon} size={22} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

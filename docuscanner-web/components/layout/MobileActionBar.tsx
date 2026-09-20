"use client";

// Bottom action bar for small screens, replacing the header's Scan/Convert/Tools/History
// links (which are hidden below `sm` to keep the header from wrapping).
// Fixed to the viewport bottom, so app/layout.tsx reserves matching bottom
// padding on <body> to keep it from covering page content.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

const ITEMS = [
  { href: "/", label: "Home", icon: "🏠" },
  { href: "/scan", label: "Scan", icon: "📷" },
  { href: "/convert", label: "Convert", icon: "🔄" },
  { href: "/tools", label: "Tools", icon: "🛠" },
  { href: "/history", label: "History", icon: "🗂" },
] as const;

export function MobileActionBar() {
  const pathname = usePathname();
  const { user, openAuthModal } = useAuth();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-black/95 sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ITEMS.map((item) => {
        // Convert and Tools each cover their hub and every page beneath it.
        const active = item.href === "/convert" || item.href === "/tools" ? pathname.startsWith(item.href) : pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
              active ? "text-zinc-900 dark:text-white" : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            <span aria-hidden className="text-base">
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => (user ? undefined : openAuthModal("login"))}
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"
      >
        <span aria-hidden className="text-base">
          👤
        </span>
        {user ? "Account" : "Sign in"}
      </button>
    </nav>
  );
}

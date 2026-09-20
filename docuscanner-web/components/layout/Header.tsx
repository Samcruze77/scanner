"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { AccountMenu } from "@/components/auth/AccountMenu";

// Scan | Convert | Tools | History. Convert is for changing a file's type; Tools is
// for editing, signing and compression.
const NAV = [
  { href: "/scan", label: "Scan" },
  { href: "/convert", label: "Convert" },
  { href: "/tools", label: "Tools" },
  { href: "/history", label: "History" },
] as const;

export function Header() {
  const { user, loading, openAuthModal } = useAuth();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-black/90">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link href="/" className="flex min-h-11 min-w-11 items-center gap-2 font-semibold">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-sm font-bold text-white dark:bg-white dark:text-black"
          >
            D
          </span>
          <span className="hidden sm:inline">DocuScanner</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 text-sm font-medium text-zinc-600 dark:text-zinc-400 sm:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-2 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white ${
                  active ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-white" : ""
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {loading ? null : user ? (
            <AccountMenu />
          ) : (
            <>
              <button
                type="button"
                onClick={() => openAuthModal("login")}
                className="min-h-11 rounded-md px-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900 sm:px-3 sm:py-2"
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => openAuthModal("signup")}
                className="min-h-11 rounded-md bg-zinc-900 px-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200 sm:px-3 sm:py-2"
              >
                <span className="sm:hidden">Sign up</span>
                <span className="hidden sm:inline">Sign up free</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

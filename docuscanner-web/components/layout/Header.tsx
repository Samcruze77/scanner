"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { Logo } from "@/components/layout/Logo";
import { NAV_ITEMS, isNavActive } from "@/components/layout/nav";

// Top bar: logo, the four places the product is organised around (see nav.ts), and
// the account controls. Below `sm` the places move to the bottom bar
// (MobileActionBar) so the header never wraps.
export function Header() {
  const { user, loading, openAuthModal } = useAuth();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg" aria-label="DocuScanner home">
          <Logo />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors ${
                  active
                    ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
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
              <button type="button" onClick={() => openAuthModal("login")} className="btn btn-ghost px-3">
                Log in
              </button>
              <button type="button" onClick={() => openAuthModal("signup")} className="btn btn-primary px-3 sm:px-4">
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

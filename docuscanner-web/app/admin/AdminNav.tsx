"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminRole } from "@/utils/admin/types";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/exports", label: "Exports" },
];

export function AdminNav({ role }: { role: AdminRole }) {
  const pathname = usePathname();

  return (
    <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-black md:w-56 md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-3 md:py-6">
      <div className="mb-2 hidden px-2 md:block">
        <p className="text-sm font-semibold">Admin</p>
        <p className="text-xs capitalize text-zinc-500">{role.replace("_", " ")}</p>
      </div>
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

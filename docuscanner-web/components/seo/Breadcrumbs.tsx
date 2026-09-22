// The visible breadcrumb trail (Home / Tools / Compress PDF). It matches the
// BreadcrumbList structured data on the same page and gives crawlers a clear path up.

import Link from "next/link";
import { HOME_CRUMB, type Crumb } from "@/utils/seo/landing";

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const trail = [HOME_CRUMB, ...crumbs];
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm">
      <ol className="muted flex flex-wrap items-center">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={crumb.path} className="flex items-center">
              {last ? (
                <span aria-current="page" className="font-medium text-fg">
                  {crumb.name}
                </span>
              ) : (
                <>
                  <Link href={crumb.path} className="inline-flex min-h-11 items-center hover:underline">
                    {crumb.name}
                  </Link>
                  <span aria-hidden className="px-2">
                    /
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

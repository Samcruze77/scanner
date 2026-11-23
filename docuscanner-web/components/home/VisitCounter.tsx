import { Icon } from "@/components/ui/icons";
import { getVisitCount } from "@/utils/analytics/visitCount.server";

// Small "N visits" badge at the top of the homepage. Server component: the number is
// fetched and cached on the server (see visitCount.server.ts). Renders nothing when the
// count is unavailable.
export async function VisitCounter() {
  const visits = await getVisitCount();
  if (visits === null) return null;
  const formatted = new Intl.NumberFormat("en-US").format(visits);

  return (
    <p
      data-testid="visit-counter"
      title="Total visits to FreePDFScanner"
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-surface px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
    >
      <Icon name="eye" size={14} className="text-blue-600 dark:text-blue-400" />
      <span>
        <span className="font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{formatted}</span>{" "}
        {visits === 1 ? "visit" : "visits"}
      </span>
    </p>
  );
}

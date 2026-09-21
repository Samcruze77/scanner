// Where the person is in the scan: Add pages -> Edit -> Export. It is a status
// display, not navigation: every action stays reachable at every step, so nothing is
// locked behind it. Done steps get a check; the current one is marked for screen readers.

import { Icon } from "@/components/ui/icons";

const STEPS = ["Add pages", "Edit", "Export"] as const;

export type WorkspaceStep = 0 | 1 | 2;

export function WorkspaceStepper({ current }: { current: WorkspaceStep }) {
  return (
    <ol aria-label="Progress" className="flex items-center gap-2 text-sm">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} aria-current={active ? "step" : undefined} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden className="h-px w-4 bg-zinc-300 dark:bg-zinc-700 sm:w-8" />}
            <span
              aria-hidden
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? "bg-emerald-600 text-white"
                  : active
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {done ? <Icon name="check" size={14} /> : index + 1}
            </span>
            <span className={active ? "font-semibold" : "muted"}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

"use client";

// A short tip at the top of a tool page (wording in ./pageTips.ts), controlled by the Help tips switch
// in the header: shown while tips are ON, hidden while OFF, and once closed it stays closed (until
// tips are switched on again, which brings closed tips back, like the scanner's ContextTip).
//
// Unlike ContextTip, which appears after someone does something, this tip is there when the page
// loads. So it is in the server HTML and takes its space from the first paint: nothing below it
// jumps (no layout shift). Before React takes over, CSS hides it for a browser that turned tips off
// or closed this tip (`data-prepaint`, with TIPS_INIT_SCRIPT in ./hintStorage.ts setting
// <html data-tips> and the list of closed tips before the first paint). After that, React decides.

import { Icon } from "@/components/ui/icons";
import { PAGE_TIPS, type PageTipId } from "./pageTips";
import { useGuidance } from "./useGuidance";

export function PageTip({ id, className = "" }: { id: PageTipId; className?: string }) {
  const { hydrated, showTip, dismiss } = useGuidance();
  if (hydrated && !showTip(id)) return null;
  return (
    <div
      role="note"
      data-tip={id}
      data-page-tip=""
      data-prepaint={hydrated ? undefined : ""}
      className={`flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100 ${className}`}
    >
      <Icon name="info" size={18} className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1">{PAGE_TIPS[id]}</p>
      <button
        type="button"
        onClick={() => dismiss(id)}
        aria-label="Dismiss this tip"
        className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
      >
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

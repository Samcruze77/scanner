"use client";

// A small, dismissible tip tied to the visitor's "show me tips" choice. It shows only when tips are
// not turned off and this tip has not been closed before, and it never covers the work: it is an
// inline note, not a modal. Closing it (or `done`) remembers that on this device.

import { useEffect } from "react";
import { Icon } from "@/components/ui/icons";
import { useGuidance } from "./useGuidance";

export function ContextTip({
  id,
  children,
  className = "",
  done = false,
  title,
  action,
}: {
  id: string;
  children: React.ReactNode;
  className?: string;
  // The person already did what the tip describes, so it is retired without being shown again.
  done?: boolean;
  title?: string;
  // An optional button that takes the person to the control the tip is about (it never does the task).
  action?: { label: string; describe: string; onClick: () => void };
}) {
  const { showTip, dismiss } = useGuidance();
  const visible = showTip(id);

  useEffect(() => {
    if (done && visible) dismiss(id);
  }, [done, visible, dismiss, id]);

  if (!visible || done) return null;
  return (
    <div role="note" data-tip={id} className={`flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100 ${className}`}>
      <Icon name="info" size={18} className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1">
        {title && <strong className="block">{title}</strong>}
        {children}
        {action && (
          <button type="button" aria-label={action.describe} onClick={action.onClick} className="ml-2 inline-flex min-h-11 items-center font-semibold underline">
            {action.label}
          </button>
        )}
      </p>
      <button type="button" onClick={() => dismiss(id)} aria-label="Dismiss this tip" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg -my-2 -mr-2">
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

"use client";

// Small, contextual first-use tips. Each shows once with a "Got it" button and
// stays dismissed on this device (localStorage only; never sent anywhere). Not a
// tutorial: one short line, exactly where the person needs it.

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icons";

const CHANGE_EVENT = "docuscanner:hint-change";
const key = (id: string) => `docuscanner.hint.${id}`;

function isDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(key(id)) === "1";
  } catch {
    // Storage blocked (private mode): treat as dismissed so a tip can't get stuck on screen.
    return true;
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function Hint({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  // The server renders nothing; the browser shows the tip after hydration when
  // it hasn't been dismissed, so there's no flash of a tip that's already gone.
  const dismissed = useSyncExternalStore(
    subscribe,
    () => isDismissed(id),
    () => true,
  );
  if (dismissed) return null;

  return (
    <div
      role="note"
      className={`notice notice-info ${className ?? ""}`}
    >
      <Icon name="info" size={18} className="mt-0.5" />
      <p className="min-w-0 flex-1">{children}</p>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(key(id), "1");
          } catch {
            // Not stored: the tip simply returns next visit.
          }
          window.dispatchEvent(new Event(CHANGE_EVENT));
        }}
        className="btn btn-ghost -my-2 -mr-2 shrink-0"
      >
        Got it
      </button>
    </div>
  );
}

// A short, permanent line of helper text (for things people need every time).
export function HelperText({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-sm text-zinc-500 dark:text-zinc-400 ${className ?? ""}`}>{children}</p>;
}

"use client";

// A gentle, inline nudge for account-gated actions (save to history, cross-
// device access) -- never a full-page blocker. Guests keep using everything
// else; this just explains what signing in would add.

import { useAuth } from "./AuthProvider";

export function RequireAuthPrompt({
  message = "Sign in to save this and access it from any device.",
}: {
  message?: string;
}) {
  const { openAuthModal } = useAuth();

  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-zinc-600 dark:text-zinc-400">{message}</span>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => openAuthModal("login")}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => openAuthModal("signup")}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Sign up free
        </button>
      </div>
    </div>
  );
}

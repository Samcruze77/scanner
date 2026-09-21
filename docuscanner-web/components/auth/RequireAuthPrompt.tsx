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
    <div className="card flex flex-col items-start gap-3 border-dashed p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="muted">{message}</span>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => openAuthModal("login")} className="btn btn-secondary">
          Log in
        </button>
        <button type="button" onClick={() => openAuthModal("signup")} className="btn btn-primary">
          Sign up free
        </button>
      </div>
    </div>
  );
}

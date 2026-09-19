"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { trackError, trackLogout } from "@/utils/analytics/events";
import { useAuth } from "./AuthProvider";

export function AccountMenu() {
  const { user } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return null;

  async function handleLogout() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        void trackError("logout", error.name || "logout_failed");
        return;
      }
      void trackLogout();
    } catch {
      void trackError("logout", "unexpected_error");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden max-w-[10rem] truncate text-sm text-zinc-600 dark:text-zinc-400 sm:inline">
        {user.email}
      </span>
      <button
        type="button"
        onClick={handleLogout}
        disabled={signingOut}
        className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        {signingOut ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}

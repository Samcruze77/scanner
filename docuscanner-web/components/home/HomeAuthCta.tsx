"use client";

import { useAuth } from "@/components/auth/AuthProvider";

export function HomeAuthCta() {
  const { user, loading, openAuthModal } = useAuth();

  if (loading || user) return null;

  return (
    <div className="card flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">
        <span className="font-semibold">Want to keep your documents?</span>{" "}
        <span className="muted">Create a free account to save them and open them from any device. Scanning stays free without one.</span>
      </p>
      <button type="button" onClick={() => openAuthModal("signup")} className="btn btn-secondary shrink-0">
        Create a free account
      </button>
    </div>
  );
}

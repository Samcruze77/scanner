"use client";

import { useAuth } from "@/components/auth/AuthProvider";

export function HomeAuthCta() {
  const { user, loading, openAuthModal } = useAuth();

  if (loading || user) return null;

  return (
    <p className="text-sm text-zinc-500">
      Already scanning without an account?{" "}
      <button
        type="button"
        onClick={() => openAuthModal("signup")}
        className="font-medium text-zinc-900 underline dark:text-white"
      >
        Create a free account
      </button>{" "}
      to save your documents and access them from any device.
    </p>
  );
}

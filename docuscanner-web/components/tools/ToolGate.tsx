"use client";

// Login gate for tools that ask for a (free) account. This is an authentication
// requirement only: it never mentions plans or premium, and the tool stays
// visible in the Tools menu either way. No tool requires it today (see
// utils/tools/registry.ts) -- signing works for guests -- but the prompt is here
// so flipping a tool's `requiresAuth` flag is all it takes.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { trackLoginRequired } from "@/utils/analytics/events";
import type { ToolDef } from "@/utils/tools/registry";

export function LoginRequiredDialog({ toolId, toolTitle, onBack }: { toolId: string; toolTitle: string; onBack: () => void }) {
  const { openAuthModal } = useAuth();
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void trackLoginRequired(toolId);
    firstRef.current?.focus();
  }, [toolId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-required-title"
      // Below the sign-in form (z-50), so choosing Sign In shows it on top.
      className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <h2 id="login-required-title" className="text-lg font-semibold">
          {toolTitle}
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in or create a free account to use this feature.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            ref={firstRef}
            type="button"
            onClick={() => openAuthModal("login")}
            className="btn btn-primary"
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => openAuthModal("signup")}
            className="btn btn-secondary"
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={onBack}
            className="btn btn-ghost"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToolGate({ tool, children }: { tool: ToolDef; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  if (!tool.requiresAuth) return <>{children}</>;
  if (loading) {
    return (
      <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
        Checking your account…
      </p>
    );
  }
  if (!user) {
    return <LoginRequiredDialog toolId={tool.id} toolTitle={tool.title} onBack={() => router.push("/tools")} />;
  }
  return <>{children}</>;
}

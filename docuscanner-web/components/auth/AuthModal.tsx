"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { trackError, trackLogin, trackSignupCompleted, trackSignupStarted } from "@/utils/analytics/events";
import { useAuth } from "./AuthProvider";

// Only mounted while open, so every open is a fresh mount -- local form
// state (mode/email/error/etc.) starts clean via useState initializers
// instead of being synced-on-open through an effect.
export function AuthModal() {
  const { authModalOpen } = useAuth();
  if (!authModalOpen) return null;
  return <AuthModalDialog />;
}

function AuthModalDialog() {
  const { authModalMode, closeAuthModal, openAuthModal } = useAuth();
  const [mode, setMode] = useState(authModalMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Runs once on mount (this component only exists while the dialog is
    // open): focus the first field and close on Escape.
    emailRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAuthModal();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchMode(next: typeof mode) {
    setError(null);
    setNotice(null);
    setMode(next);
    openAuthModal(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    const supabase = createClient();

    try {
      if (mode === "signup") {
        void trackSignupStarted("email");
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) {
          setError(signUpError.message);
          void trackError("signup", signUpError.name || "signup_failed");
          return;
        }
        void trackSignupCompleted("email");
        if (!data.session) {
          // Email confirmation required -- no session yet, nothing to gate on.
          setNotice("Check your email to confirm your account, then log in.");
          setMode("login");
          return;
        }
        closeAuthModal();
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(signInError.message);
          void trackError("login", signInError.name || "login_failed");
          return;
        }
        void trackLogin("email");
        closeAuthModal();
      }
    } catch {
      setError("Something went wrong. Please try again.");
      void trackError(mode, "unexpected_error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeAuthModal();
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="auth-modal-title" className="text-lg font-semibold">
            {mode === "signup" ? "Create your free account" : "Log in"}
          </h2>
          <button
            type="button"
            onClick={closeAuthModal}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-sm text-zinc-500">
          {mode === "signup"
            ? "Free, no credit card. You can keep scanning as a guest too."
            : "Welcome back."}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Email</span>
            <input
              ref={emailRef}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-black"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Password</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-black"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-emerald-600 dark:text-emerald-400">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 w-full rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {submitting ? "Please wait…" : mode === "signup" ? "Sign up" : "Log in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-zinc-500">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="inline-flex min-h-11 items-center font-medium text-zinc-900 underline dark:text-white"
              >
                Log in
              </button>
            </>
          ) : (
            <>
              New here?{" "}
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="inline-flex min-h-11 items-center font-medium text-zinc-900 underline dark:text-white"
              >
                Create a free account
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

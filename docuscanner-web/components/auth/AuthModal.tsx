"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  trackError,
  trackLogin,
  trackPasswordResetRequested,
  trackSignupCompleted,
  trackSignupStarted,
} from "@/utils/analytics/events";
import { authErrorCode, authErrorMessage, GENERIC_AUTH_ERROR, isRateLimited } from "@/utils/auth/messages";
import { authRedirectUrl } from "@/utils/auth/redirects";
import { confirmProblem, emailProblem, PASSWORD_HINT, passwordProblem } from "@/utils/auth/validation";
import { PasswordField } from "./PasswordField";
import { useAuth, type AuthModalMode } from "./AuthProvider";

// Only mounted while open, so every open is a fresh mount -- local form
// state (mode/email/error/etc.) starts clean via useState initializers
// instead of being synced-on-open through an effect.
export function AuthModal() {
  const { authModalOpen } = useAuth();
  if (!authModalOpen) return null;
  return <AuthModalDialog />;
}

interface FieldErrors {
  email?: string;
  password?: string;
  confirm?: string;
}

// How long "Send again" waits, so the reset email can't be hammered.
const RESEND_SECONDS = 60;

const INPUT_CLASS = "min-h-11 w-full rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700 dark:bg-black";
const LINK_BUTTON = "inline-flex min-h-11 items-center font-medium text-zinc-900 underline dark:text-white";

function AuthModalDialog() {
  const { authModalMode, closeAuthModal, openAuthModal } = useAuth();
  const [mode, setMode] = useState<AuthModalMode>(authModalMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // The address a reset link was requested for: shows the confirmation view.
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Close on Escape.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAuthModal();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start in the first field, whichever form is showing.
  useEffect(() => {
    emailRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function switchMode(next: AuthModalMode) {
    setError(null);
    setNotice(null);
    setFieldErrors({});
    // Nothing typed as a password carries over to another form.
    setPassword("");
    setConfirm("");
    setResetSentTo(null);
    setMode(next);
    openAuthModal(next);
  }

  // Sends the reset email. Whatever the address, a request the server accepts gets
  // the same confirmation, so this screen can't be used to find out who has an account.
  async function requestReset(address: string): Promise<boolean> {
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: authRedirectUrl("/reset-password"),
      });
      if (resetError) {
        void trackError("password_reset_request", authErrorCode(resetError, "reset_failed"));
        if (isRateLimited(resetError)) setError(authErrorMessage(resetError, "reset_request"));
        else if (resetError.code === "email_address_invalid" || resetError.code === "validation_failed") {
          setFieldErrors({ email: authErrorMessage(resetError, "reset_request") });
        } else setError(authErrorMessage(resetError, "reset_request"));
        return false;
      }
      void trackPasswordResetRequested();
      return true;
    } catch {
      void trackError("password_reset_request", "unexpected_error");
      setError(GENERIC_AUTH_ERROR);
      return false;
    }
  }

  async function handleResend() {
    if (!resetSentTo || cooldown > 0 || submitting) return;
    setError(null);
    setSubmitting(true);
    const ok = await requestReset(resetSentTo);
    setSubmitting(false);
    if (ok) setCooldown(RESEND_SECONDS);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    // One consistent set of checks, shown next to the field they're about.
    const problems: FieldErrors = { email: emailProblem(email) ?? undefined };
    if (mode === "signup") {
      problems.password = passwordProblem(password) ?? undefined;
      problems.confirm = confirmProblem(password, confirm) ?? undefined;
    } else if (mode === "login") {
      // Log-in only needs something typed: an older, shorter password must still work.
      problems.password = password.length === 0 ? "Enter your password." : undefined;
    }
    setFieldErrors(problems);
    if (problems.email || problems.password || problems.confirm) return;

    const address = email.trim();
    setSubmitting(true);

    if (mode === "forgot") {
      const ok = await requestReset(address);
      setSubmitting(false);
      if (ok) {
        setResetSentTo(address);
        setCooldown(RESEND_SECONDS);
      }
      return;
    }

    const supabase = createClient();

    try {
      if (mode === "signup") {
        void trackSignupStarted("email");
        // The confirmation link brings the person back to the site they signed up on. The
        // trailing slash matters: it is the form the project's Redirect URLs allow-list holds
        // (https://…vercel.app/ and http://localhost:3000/**), and a bare origin is refused.
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: authRedirectUrl("/") },
        });
        if (signUpError) {
          setError(authErrorMessage(signUpError, "signup"));
          void trackError("signup", authErrorCode(signUpError, "signup_failed"));
          return;
        }
        void trackSignupCompleted("email");
        if (!data.session) {
          // Email confirmation required -- no session yet, nothing to gate on.
          setNotice("Check your email to confirm your account, then log in.");
          setPassword("");
          setConfirm("");
          setMode("login");
          return;
        }
        closeAuthModal();
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: address, password });
        if (signInError) {
          setError(authErrorMessage(signInError, "login"));
          void trackError("login", authErrorCode(signInError, "login_failed"));
          return;
        }
        void trackLogin("email");
        closeAuthModal();
      }
    } catch {
      setError(GENERIC_AUTH_ERROR);
      void trackError(mode, "unexpected_error");
    } finally {
      setSubmitting(false);
    }
  }

  const title = resetSentTo ? "Check your email" : mode === "signup" ? "Create your free account" : mode === "forgot" ? "Reset your password" : "Log in";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeAuthModal();
      }}
    >
      <div className="my-auto w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="auth-modal-title" className="text-lg font-semibold">
            {title}
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

        {resetSentTo ? (
          <div className="space-y-3">
            <div role="status" className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              <p>
                If an account exists for <strong className="break-words">{resetSentTo}</strong>, we&apos;ve sent a link to reset its password.
              </p>
              <p>It can take a few minutes to arrive. Check your spam folder too. The link works once and expires after about an hour.</p>
              <p>Open it in this same browser to choose your new password.</p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || submitting}
              className="min-h-11 w-full rounded-md border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
            >
              {submitting ? "Sending…" : cooldown > 0 ? `Send again in ${cooldown}s` : "Send the link again"}
            </button>
            <button
              type="button"
              onClick={() => switchMode("login")}
              className="min-h-11 w-full rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Back to log in
            </button>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-zinc-500">
              {mode === "signup"
                ? "Free, no credit card. You can keep scanning as a guest too."
                : mode === "forgot"
                  ? "Enter the email you signed up with and we'll send you a link to choose a new password."
                  : "Welcome back."}
            </p>

            {/* noValidate: the checks (and their messages) are ours, so every screen words them the same way. */}
            <form key={mode} onSubmit={handleSubmit} noValidate className="space-y-3">
              <div className="text-sm">
                <label htmlFor="auth-email" className="mb-1 block text-zinc-600 dark:text-zinc-400">
                  Email
                </label>
                <input
                  id="auth-email"
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldErrors((f) => ({ ...f, email: undefined }));
                  }}
                  aria-invalid={fieldErrors.email ? true : undefined}
                  aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
                  className={INPUT_CLASS}
                />
                {fieldErrors.email && (
                  <p id="auth-email-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              {mode !== "forgot" && (
                <PasswordField
                  label="Password"
                  value={password}
                  onChange={(value) => {
                    setPassword(value);
                    setFieldErrors((f) => ({ ...f, password: undefined }));
                  }}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  error={fieldErrors.password}
                  hint={mode === "signup" ? PASSWORD_HINT : undefined}
                />
              )}

              {mode === "signup" && (
                <PasswordField
                  label="Confirm password"
                  value={confirm}
                  onChange={(value) => {
                    setConfirm(value);
                    setFieldErrors((f) => ({ ...f, confirm: undefined }));
                  }}
                  autoComplete="new-password"
                  error={fieldErrors.confirm}
                />
              )}

              {mode === "login" && (
                <div className="-mt-1 flex justify-end">
                  <button type="button" onClick={() => switchMode("forgot")} className="inline-flex min-h-11 items-center text-sm font-medium text-zinc-700 underline dark:text-zinc-300">
                    Forgot password?
                  </button>
                </div>
              )}

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
                {submitting ? "Please wait…" : mode === "signup" ? "Sign up" : mode === "forgot" ? "Send reset link" : "Log in"}
              </button>
            </form>

            <p className="mt-4 text-center text-sm text-zinc-500">
              {mode === "signup" ? (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={() => switchMode("login")} className={LINK_BUTTON}>
                    Log in
                  </button>
                </>
              ) : mode === "forgot" ? (
                <button type="button" onClick={() => switchMode("login")} className={LINK_BUTTON}>
                  Back to log in
                </button>
              ) : (
                <>
                  New here?{" "}
                  <button type="button" onClick={() => switchMode("signup")} className={LINK_BUTTON}>
                    Create a free account
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

// Where the emailed reset link lands. The existing Supabase client does the
// real work: opening the link in the browser that asked for it turns the
// one-time code into a recovery session and announces PASSWORD_RECOVERY
// (AuthProvider records that). This page then lets the person choose a new
// password with supabase.auth.updateUser, and returns them to the app, signed in.
//
// The four states:
//   checking  - waiting for the client to finish reading the link
//   form      - a recovery session exists: choose and confirm a new password
//   done      - password changed
//   invalid   - no usable recovery session: the link is expired, already used,
//               damaged, or was opened in a different browser than it was
//               requested from. Always offers a way to get a new one.
// A password typed here goes to Supabase and nowhere else: not to analytics,
// not to the URL, not to storage, not to the console.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { trackError, trackPasswordResetCompleted } from "@/utils/analytics/events";
import { authErrorCode, authErrorMessage, GENERIC_AUTH_ERROR, isSessionMissing } from "@/utils/auth/messages";
import { confirmProblem, PASSWORD_HINT, passwordProblem } from "@/utils/auth/validation";
import { useAuth } from "./AuthProvider";
import { PasswordField } from "./PasswordField";

// The client reports a recovery session a moment after it finishes reading the
// link, so "no session" isn't declared until this much time has passed.
const SETTLE_MS = 700;
const REDIRECT_AFTER_MS = 2500;

// The link's own error, if it carries one (an expired or reused link comes back
// with error_code=otp_expired in the address).
function linkExpired(): boolean {
  const text = `${window.location.hash}&${window.location.search}`;
  return /otp_expired|access_denied/.test(text);
}

const CARD = "card space-y-4 p-6 shadow-sm";

export function ResetPasswordForm() {
  const { session, loading, passwordRecovery, clearPasswordRecovery, openAuthModal } = useAuth();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // The recovery session disappeared while the form was open (the link expired).
  const [sessionLost, setSessionLost] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.push("/"), REDIRECT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [done, router]);

  const view: "checking" | "form" | "done" | "invalid" = done
    ? "done"
    : sessionLost
      ? "invalid"
      : loading
        ? "checking"
        : passwordRecovery && session
          ? "form"
          : settled
            ? "invalid"
            : "checking";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const problems = {
      password: passwordProblem(password) ?? undefined,
      confirm: confirmProblem(password, confirm) ?? undefined,
    };
    setErrors(problems);
    if (problems.password || problems.confirm) return;

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        void trackError("password_reset_update", authErrorCode(error, "update_failed"));
        if (isSessionMissing(error)) {
          clearPasswordRecovery();
          setSessionLost(true);
        } else setFormError(authErrorMessage(error, "reset_update"));
        return;
      }
      void trackPasswordResetCompleted();
      clearPasswordRecovery();
      // Drop what was typed the moment it has been used.
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch {
      void trackError("password_reset_update", "unexpected_error");
      setFormError(GENERIC_AUTH_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  if (view === "checking") {
    return (
      <div role="status" className={CARD}>
        <h1 className="text-lg font-semibold">Checking your link…</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">One moment.</p>
      </div>
    );
  }

  if (view === "done") {
    return (
      <div role="status" className={CARD}>
        <h1 className="text-lg font-semibold">Password updated</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Your new password is set and you&apos;re signed in. Taking you back to PDFScanner…</p>
        <Link href="/" className="btn btn-primary w-full">
          Continue to PDFScanner
        </Link>
      </div>
    );
  }

  if (view === "invalid") {
    const expired = linkExpired();
    return (
      <div className={CARD}>
        <h1 className="text-lg font-semibold">{expired ? "This reset link has expired" : "This reset link can't be used"}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Reset links work once and expire after about an hour. This one may have been used already, may have expired, or was opened in a different browser than the one you asked for it from.
        </p>
        <button
          type="button"
          onClick={() => openAuthModal("forgot")}
          className="btn btn-primary w-full"
        >
          Send me a new link
        </button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <button type="button" onClick={() => openAuthModal("login")} className="inline-flex min-h-11 items-center font-medium underline">
            Back to log in
          </button>
          <Link href="/" className="inline-flex min-h-11 items-center font-medium underline">
            Go to PDFScanner
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={CARD}>
      <div>
        <h1 className="text-lg font-semibold">Choose a new password</h1>
        {session?.user.email && (
          <p className="mt-1 break-words text-sm text-zinc-500 dark:text-zinc-400">
            For <span className="font-medium text-zinc-700 dark:text-zinc-300">{session.user.email}</span>
          </p>
        )}
      </div>

      <PasswordField
        label="New password"
        value={password}
        onChange={(value) => {
          setPassword(value);
          setErrors((current) => ({ ...current, password: undefined }));
        }}
        autoComplete="new-password"
        error={errors.password}
        hint={PASSWORD_HINT}
        autoFocus
      />
      <PasswordField
        label="Confirm new password"
        value={confirm}
        onChange={(value) => {
          setConfirm(value);
          setErrors((current) => ({ ...current, confirm: undefined }));
        }}
        autoComplete="new-password"
        error={errors.confirm}
      />

      {formError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn btn-primary w-full"
      >
        {submitting ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}

"use client";

// Lets a signed-in user delete their own account (Edge Function
// `delete-account`). Requires typing DELETE. Everything the deletion removes,
// and the 24-hour rule for signing up again, is stated before the button.

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { createClient } from "@/utils/supabase/client";

export function DeleteAccountPanel() {
  const { user, loading, openAuthModal } = useAuth();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (loading) return null;

  if (done) {
    return (
      <section role="status" className="card p-5 sm:p-6">
        <h2 className="section-title">Your account has been deleted</h2>
        <p className="muted mt-2 text-sm leading-6">
          Your account and saved documents have been removed. You can sign up again with the same email at any time after 24
          hours.
        </p>
        <Link href="/" className="btn btn-primary mt-4 inline-flex">
          Back to the home page
        </Link>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="card p-5 sm:p-6">
        <p className="muted text-sm">Log in to manage your account.</p>
        <button type="button" onClick={() => openAuthModal("login")} className="btn btn-primary mt-3">
          Log in
        </button>
      </section>
    );
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: invokeError } = await supabase.functions.invoke("delete-account", {
        method: "POST",
        body: { confirm: "DELETE" },
      });
      if (invokeError) {
        // supabase-js hides the function's own message inside the response body.
        let message = "Couldn't delete your account. Please try again.";
        const ctx = (invokeError as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
          const body = await ctx.json().catch(() => null);
          if (body?.error) message = String(body.error);
        }
        setError(message);
        return;
      }
      if (!data?.ok) {
        setError("Couldn't delete your account. Please try again.");
        return;
      }
      await supabase.auth.signOut();
      setDone(true);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card p-5 sm:p-6">
        <h2 className="section-title">Signed in as</h2>
        <p className="muted mt-2 break-all text-sm">{user.email}</p>
      </section>

      <section className="card border-red-300 p-5 dark:border-red-900 sm:p-6" aria-labelledby="delete-account-title">
        <h2 id="delete-account-title" className="section-title">
          Delete account
        </h2>
        <div className="muted mt-3 space-y-3 text-sm leading-6">
          <p>Deleting your account permanently removes:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>your sign-in and account details;</li>
            <li>every document you saved to your account, including the stored files;</li>
            <li>your profile, subscription and usage records.</li>
          </ul>
          <p>
            Anonymous usage statistics recorded earlier are kept without any link to you. This can&apos;t be undone.
          </p>
          <p className="rounded-lg bg-zinc-100 px-3 py-2 font-medium text-inherit dark:bg-zinc-800">
            Note: after you delete your account, you can sign up again with the same email at any time after 24 hours.
          </p>
        </div>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium">Type DELETE to confirm</span>
          <input
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="w-full max-w-xs rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleDelete}
          disabled={busy || confirm !== "DELETE"}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete my account"}
        </button>
      </section>
    </div>
  );
}

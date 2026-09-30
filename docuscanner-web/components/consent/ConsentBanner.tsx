"use client";

// Cookie / privacy choices. Shown to every visitor until they choose, and
// reopenable at any time from the footer ("Cookie settings"). Non-essential
// technologies stay OFF until the visitor opts in: "Reject non-essential" is
// as prominent as "Accept all", and nothing is pre-ticked. What each switch
// controls matches the Privacy Policy (sections 6, 7 and 8) -- see
// utils/consent/consent.ts. The visitor's choice itself is stored locally as
// strictly necessary storage.

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  ACCEPT_ALL,
  OPEN_CONSENT_EVENT,
  REJECT_ALL,
  readConsent,
  subscribeConsent,
  writeConsent,
  type ConsentCategory,
  type ConsentChoice,
} from "@/utils/consent/consent";

const OPTIONS: { key: ConsentCategory; title: string; body: string }[] = [
  {
    key: "analytics",
    title: "Usage analytics",
    body: "Anonymous visitor and session IDs, pages and tools used, a live-activity signal, and approximate location (country, region, city) worked out from your IP address. Helps us fix problems and see what is used. Never includes your documents.",
  },
  {
    key: "advertising",
    title: "Advertising",
    body: "Counting ad views and clicks so advertisers can be told how ads performed, and playing video ads from YouTube or Vimeo, which may set their own cookies.",
  },
  {
    key: "recordings",
    title: "Session recordings (Microsoft Clarity)",
    body: "Clarity records how pages are used (clicks, scrolling, page events) to spot usability problems. Document previews, extracted text and sign-in forms are masked.",
  },
];

export function ConsentBanner() {
  // "Has the visitor decided?" read from storage. The server snapshot says
  // "yes" so the banner is never part of the server-rendered HTML; the real
  // answer is applied on the client right after hydration.
  const decided = useSyncExternalStore(
    (onChange) => subscribeConsent(onChange),
    () => readConsent() !== null,
    () => true,
  );
  const [reopened, setReopened] = useState(false);
  const [detail, setDetail] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice>(REJECT_ALL);
  const titleId = useId();
  const open = !decided || reopened;

  useEffect(() => {
    const reopen = () => {
      const current = readConsent();
      setChoice(current ? { analytics: current.analytics, advertising: current.advertising, recordings: current.recordings } : REJECT_ALL);
      setDetail(true);
      setReopened(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  function save(next: ConsentChoice) {
    writeConsent(next);
    setChoice(next);
    setReopened(false);
    setDetail(false);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed inset-x-0 bottom-16 z-[60] px-3 pb-3 sm:bottom-0 sm:px-4 sm:pb-4"
    >
      <div className="mx-auto max-h-[80vh] max-w-3xl overflow-y-auto rounded-2xl border border-zinc-200 bg-elevated p-4 shadow-2xl dark:border-zinc-700 sm:p-5">
        <h2 id={titleId} className="text-base font-semibold">
          Your privacy choices
        </h2>
        <p className="muted mt-1.5 text-sm leading-6">
          We use essential storage to keep the site working and you signed in. With your permission we also use analytics,
          advertising measurement and session recordings. All of these are off unless you turn them on, and you can change
          your mind at any time from &ldquo;Cookie settings&rdquo; in the footer. See our{" "}
          <Link href="/privacy#section-6" className="underline">
            Privacy Policy
          </Link>
          .
        </p>

        {detail && (
          <ul className="mt-3 space-y-3">
            <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <p className="text-sm font-medium">Essential (always on)</p>
              <p className="muted mt-0.5 text-xs leading-5">Sign-in, security, your theme, saved signatures and this choice. The site cannot work without them.</p>
            </li>
            {OPTIONS.map((o) => (
              <li key={o.key} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={choice[o.key]}
                    onChange={(e) => setChoice((c) => ({ ...c, [o.key]: e.target.checked }))}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <span>
                    <span className="block text-sm font-medium">{o.title}</span>
                    <span className="muted mt-0.5 block text-xs leading-5">{o.body}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <div className="sticky bottom-0 -mx-4 mt-4 flex flex-col gap-2 border-t border-zinc-200 bg-elevated px-4 pb-1 pt-3 dark:border-zinc-700 sm:-mx-5 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
          <button type="button" onClick={() => save(ACCEPT_ALL)} className="btn btn-primary">
            Accept all
          </button>
          <button type="button" onClick={() => save(REJECT_ALL)} className="btn btn-secondary">
            Reject non-essential
          </button>
          {detail ? (
            <button type="button" onClick={() => save(choice)} className="btn btn-secondary">
              Save my choices
            </button>
          ) : (
            <button type="button" onClick={() => setDetail(true)} className="btn btn-ghost">
              Choose what to allow
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

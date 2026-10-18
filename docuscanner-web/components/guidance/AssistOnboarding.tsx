"use client";

// The one-time question: "Would you like a little help while using FreePDFScanner?"
// A small card beside the page, never a modal and never a sign-up. It appears once, only at a quiet
// moment (tab visible, no dialog or cookie banner open, nobody typing, no editor open), and the answer
// is remembered on this device. "No thanks" is final; the floating Ask me button stays either way.
//
// It never competes with another card: when the install card (or any dialog) is up it steps aside and
// comes back when the page is quiet again. If it is ignored for a while it goes away for the rest of
// the visit, and after a few ignored visits it stops asking (nothing is recorded about the person).
//
// It sits above the phone's bottom bar and the Ask me button. If it would cover an advertisement, a
// main document action (Upload, Edit page, Create PDF ...) or a field, it moves to the top of the page,
// and if nowhere is clear it waits out of sight until the page is scrolled or resized.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { shouldAskTips } from "@/utils/guidance/preferences";
import { useGuidance } from "@/components/guidance/useGuidance";

const HIDDEN_ON = ["/admin", "/reset-password"];
const DELAY_MS = 4000;
// Ignored for this long on screen: stop showing it for the rest of this visit.
const IGNORE_AFTER_MS = 45_000;
const SESSION_KEY = "docuscanner.assist.ignored";

function ignoredThisVisit(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}
const OBSTACLES = 'aside[data-ad-placement], [data-assistant-id^="scan-"], [data-assistant-id="file-dropzone"], main input, main textarea, main canvas';

type Slot = "bottom" | "top" | "hidden";
const SLOT_CLASS: Record<Slot, string> = {
  bottom: "bottom-[calc(7.25rem+env(safe-area-inset-bottom))] sm:bottom-4",
  top: "top-[4.75rem] sm:top-[5rem]",
  hidden: "invisible bottom-[calc(7.25rem+env(safe-area-inset-bottom))] sm:bottom-4",
};

function covers(card: HTMLElement): boolean {
  const r = card.getBoundingClientRect();
  for (const el of document.querySelectorAll(OBSTACLES)) {
    if (card.contains(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) return true;
  }
  return false;
}

export function AssistOnboarding() {
  const pathname = usePathname() || "/";
  const { hydrated, state, setTips, markAsked } = useGuidance();
  const [quiet, setQuiet] = useState(false);
  const [slot, setSlot] = useState<Slot>("bottom");
  // Nothing is drawn before the page has hydrated, so reading the session here cannot mismatch.
  const [ignored, setIgnored] = useState(() => typeof window !== "undefined" && ignoredThisVisit());
  const cardRef = useRef<HTMLElement>(null);
  const wanted = hydrated && !ignored && shouldAskTips(state) && !HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (!wanted) return;
    let since = 0;
    const timer = window.setInterval(() => {
      const active = document.activeElement as HTMLElement | null;
      const typing = !!active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName));
      const dialogOpen = !!document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open], [data-install-card]');
      const calm = document.visibilityState === "visible" && !dialogOpen && !typing && document.hasFocus();
      if (!calm) {
        since = 0;
        setQuiet(false);
        setSlot("bottom");
        return;
      }
      since += 500;
      if (since >= DELAY_MS) setQuiet(true);
      const card = cardRef.current;
      if (card && covers(card)) setSlot((s) => (s === "bottom" ? "top" : "hidden"));
    }, 500);
    // Scrolling or resizing changes what is under the card: look again from the bottom.
    const retry = () => setSlot("bottom");
    window.addEventListener("scroll", retry, { passive: true });
    window.addEventListener("resize", retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", retry);
      window.removeEventListener("resize", retry);
    };
  }, [wanted]);

  // Seen for a good while and never answered: leave the person alone for the rest of this visit.
  useEffect(() => {
    if (!wanted || !quiet) return;
    const timer = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // Without session storage it can only return on the next page load; fine.
      }
      setIgnored(true);
      markAsked();
    }, IGNORE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [wanted, quiet, markAsked]);

  if (!wanted || !quiet) return null;

  return (
    <section
      ref={cardRef}
      aria-label="Help while you use FreePDFScanner"
      data-assist-onboarding
      data-slot={slot}
      className={`fixed left-3 right-3 z-30 rounded-2xl border border-zinc-200 bg-elevated p-4 shadow-xl dark:border-zinc-700 sm:left-4 sm:right-auto sm:w-[24rem] ${SLOT_CLASS[slot]}`}
    >
      <p className="text-sm font-semibold">Would you like a little help while using FreePDFScanner?</p>
      <p className="muted mt-1 text-sm leading-6">We can show simple tips to help you find tools, edit documents, and download your finished files.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" data-assistant-id="assist-tips-yes" onClick={() => setTips("on")} className="btn btn-primary">
          Yes, show me tips
        </button>
        <button type="button" data-assistant-id="assist-tips-no" onClick={() => setTips("off")} className="btn btn-secondary">
          No thanks
        </button>
      </div>
    </section>
  );
}

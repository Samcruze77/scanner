"use client";

// The floating "Ask me" button. This file is all that loads on every page: a small button
// and nothing else. The chat panel, the product knowledge and the guide are a separate chunk
// that is only fetched the first time the button is pressed (or when it is about to be, on
// hover/focus), so the assistant costs the document workflows nothing.
//
// Look: closed, it is a compact, light-blue translucent pill that stays visible without shouting (36 px
// tall, drawn from the theme's own surface, text and line colours, so Light, Warm Beige and
// Dark each get a matching version). Hover and keyboard focus make it more opaque with a
// focus ring; while the chat is open it turns solid, bold and blue so it is obvious the
// assistant is active, and pressing it closes the chat. The visible pill is small but the
// clickable area around it is at least 44 px, so it stays easy to tap.
//
// Placement: bottom right, above the phone's bottom navigation bar. It sits below the cookie
// banner and every full-screen editor and dialog, so it never covers a Download button, an
// editor control or a dialog; the editors open over it. Not shown on the admin pages or the
// password-reset page.

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";

const AssistantPanel = dynamic(() => import("./AssistantPanel").then((m) => m.AssistantPanel), { ssr: false });

export const OPEN_ASSISTANT_EVENT = "ds-open-assistant";

const HIDDEN_ON =["/admin", "/reset-password"];
// What the closed launcher keeps out of the way of.
const AVOID = 'aside[data-ad-placement], [data-assistant-id^="scan-"], [data-assistant-id="file-dropzone"], [data-assistant-avoid]';

export function AssistantLauncher() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  // Once opened, the panel stays mounted (hidden when closed) so the conversation survives
  // closing it and moving between pages. It is only ever kept in memory.
  const [everOpened, setEverOpened] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // How far the closed launcher steps up to stay clear of an advertisement, or of a main document
  // action (Create PDF, Download PDF, Edit page ...), that has scrolled into its corner. Those are never
  // covered; the launcher moves instead.
  const [lift, setLift] = useState(0);
  const liftRef = useRef(0);

  // Lets other parts of the page (the "Still working?" help card) open the chat.
  useEffect(() => {
    const openFromEvent = () => {
      setEverOpened(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_ASSISTANT_EVENT, openFromEvent);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, openFromEvent);
  }, []);

  useEffect(() => {
    if (open) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const button = buttonRef.current;
      if (!button) return;
      const r = button.getBoundingClientRect();
      const baseTop = r.top + liftRef.current;
      const baseBottom = r.bottom + liftRef.current;
      let next = 0;
      for (const ad of document.querySelectorAll(AVOID)) {
        const a = ad.getBoundingClientRect();
        if (a.width === 0 || a.height === 0) continue;
        const overlapsX = a.left < r.right && a.right > r.left;
        const overlapsY = a.top < baseBottom + 4 && a.bottom > baseTop - 4;
        if (overlapsX && overlapsY) next = Math.max(next, baseBottom - a.top + 8);
      }
      next = Math.min(next, 240);
      if (Math.abs(next - liftRef.current) > 1) {
        liftRef.current = next;
        setLift(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const late = window.setTimeout(schedule, 1500); // ads fill in after the page loads
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Content that appears or disappears (a tip, a notice, a finished PDF) moves the controls too.
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
      window.clearTimeout(late);
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [open, pathname]);

  // Escape closes the chat from anywhere on the page while it is open, not only when focus is
  // already inside the panel (for example right after pressing the launcher).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      setOpen(false);
      requestAnimationFrame(() => buttonRef.current?.focus());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  function openPanel() {
    setEverOpened(true);
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    // Hand focus back so keyboard users land where they were.
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  return (
    <>
      {everOpened && <AssistantPanel open={open} pathname={pathname} onClose={closePanel} />}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? closePanel() : openPanel())}
        onPointerEnter={() => void import("./AssistantPanel")}
        onFocus={() => void import("./AssistantPanel")}
        aria-label={open ? "Close the help assistant" : "Ask FreePDFScanner: open the help assistant"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={everOpened ? "assistant-panel" : undefined}
        data-assistant-launcher
        data-state={open ? "open" : "closed"}
        style={!open && lift ? { transform: `translateY(-${lift}px)` } : undefined}
        // The button is the (at least 44 px) touch target; the pill inside is the visible part.
        className="group fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] right-1 z-30 flex min-h-11 min-w-11 items-center justify-center rounded-full transition-transform duration-150 focus-visible:outline-none sm:bottom-3 sm:right-3"
      >
        <span
          className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-[opacity,background-color,box-shadow] duration-150 group-focus-visible:ring-2 group-focus-visible:ring-blue-600 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[color:var(--page)] ${
            open
              ? "border-blue-700 bg-blue-600 font-bold text-white opacity-100 shadow-md"
              : "border-blue-500/60 bg-[color:color-mix(in_srgb,color-mix(in_srgb,#3b82f6_20%,var(--surface))_92%,transparent)] font-semibold text-blue-900 opacity-95 shadow-sm backdrop-blur-sm group-hover:bg-[color:color-mix(in_srgb,color-mix(in_srgb,#3b82f6_26%,var(--surface))_96%,transparent)] group-hover:opacity-100 group-hover:shadow-md group-focus-visible:opacity-100 dark:border-blue-400/60 dark:text-blue-200"
          }`}
        >
          <Icon name="info" size={16} />
          <span>{open ? "Close" : "Ask me"}</span>
        </span>
      </button>
    </>
  );
}

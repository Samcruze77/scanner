"use client";

// The floating "Ask me anything" button. This file is all that loads on every page: a
// small button and nothing else. The chat panel, the product knowledge and the guide
// are a separate chunk that is only fetched the first time the button is pressed (or
// when it is about to be, on hover/focus), so the assistant costs the document
// workflows nothing.
//
// Placement: bottom right, above the phone's bottom navigation bar. It sits below the
// cookie banner and every full-screen editor and dialog, so it never covers a Download
// button, an editor control or a dialog; the editors open over it. It is not shown on
// the admin pages or the password-reset page.

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";

const AssistantPanel = dynamic(() => import("./AssistantPanel").then((m) => m.AssistantPanel), { ssr: false });

const HIDDEN_ON = ["/admin", "/reset-password"];

export function AssistantLauncher() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  // Once opened, the panel stays mounted (hidden when closed) so the conversation survives
  // closing it and moving between pages. It is only ever kept in memory.
  const [everOpened, setEverOpened] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

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
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          onClick={openPanel}
          onPointerEnter={() => void import("./AssistantPanel")}
          onFocus={() => void import("./AssistantPanel")}
          aria-label="Ask FreePDFScanner: open the help assistant"
          aria-haspopup="dialog"
          data-assistant-launcher
          className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 z-30 flex min-h-12 items-center gap-2 rounded-full bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg ring-1 ring-black/10 hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:bottom-5 sm:right-5"
        >
          <Icon name="info" size={20} />
          <span className="hidden sm:inline">Ask me anything</span>
          <span className="sm:hidden">Ask</span>
        </button>
      )}
    </>
  );
}

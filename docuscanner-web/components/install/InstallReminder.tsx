"use client";

// Small, dismissible cards that sit beside the page (never a modal) and never block anything:
//   done   -> after a file was saved: "Did you get everything done?" then, only on "Yes", an install invitation
//   browse -> after meaningful browsing with nothing started: a gentle "Keep FreePDFScanner close"
//   help   -> a file was chosen, nothing saved, visitor quiet for a while: an offer of help, never an install pitch
// See utils/install/reminder.ts for the rules and thresholds. The signals are in-page counters held in memory;
// nothing is tracked or sent. The only thing stored is the visitor's own quiet period / "don't remind me again".
//
// Safe to interrupt means: tab visible and focused (so no native file picker is open), no dialog open (editors,
// export and crop dialogs, the cookie banner), no camera preview, nobody typing. While a card is up it hides
// itself if it would cover a button, input, canvas or advertisement, so it never sits on top of the work.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { OPEN_ASSISTANT_EVENT } from "@/components/assistant/AssistantLauncher";
import { InstallGuide } from "./InstallGuide";
import {
  SHOW_DELAY_MS,
  TASK_COMPLETE_EVENT,
  afterAnswer,
  afterHelp,
  browsingEngaged,
  isExitIntent,
  mayShow,
  newActivity,
  probePage,
  readState,
  readyToShow,
  unfinishedDue,
  writeState,
  type Activity,
  type Answer,
  type Kind,
} from "@/utils/install/reminder";
import { isStandalone } from "@/utils/install/platform";
import { canPrompt, promptInstall, startCapturingInstallPrompt, subscribeInstall, wasInstalled } from "@/utils/install/prompt";

startCapturingInstallPrompt();

const HIDDEN_ON = ["/admin", "/reset-password"];
const TICK_MS = 1000;
// A finished task is only worth mentioning for a little while; after this the moment has passed.
const DONE_WINDOW_MS = 90_000;

// Where the card sits. It starts at the bottom (above the phone bar and Ask me); if that would cover a control it moves
// to the top, below the header, and if nowhere is clear it waits invisibly until the page is scrolled.
type Slot = "bottom" | "top-left" | "top-right";
const SLOTS: Slot[] = ["bottom", "top-left", "top-right"];
const OBSTACLES = 'main button, main input, main textarea, main canvas, main [role="button"], main a.btn, main label.btn, main summary, aside[data-ad-placement]';

const SLOT_CLASS: Record<Slot, string> = {
  bottom: "inset-x-3 bottom-[calc(7.25rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[26rem]",
  "top-left": "inset-x-3 sm:inset-x-auto sm:left-4 sm:w-[26rem]",
  "top-right": "sm:right-4 sm:w-[26rem]",
};

interface CardState {
  kind: Kind;
  step: "ask" | "yes";
  note?: string;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function InstallReminder() {
  const pathname = usePathname() || "/";
  const [card, setCard] = useState<CardState | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [covering, setCovering] = useState(false);
  const [slot, setSlot] = useState<Slot>("bottom");
  const [topPx, setTopPx] = useState(72);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardStateRef = useRef<CardState | null>(null);

  const activity = useRef<Activity>(newActivity());
  const lastInteraction = useRef(0);
  const pages = useRef(new Set<string>());
  const doneAt = useRef<number | null>(null);
  const installShown = useRef(false);
  const helpShown = useRef(false);
  const guideOpenRef = useRef(false);
  useEffect(() => {
    cardStateRef.current = card;
    guideOpenRef.current = guideOpen;
  }, [card, guideOpen]);

  const hiddenHere = HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const save = useCallback((fn: (s: ReturnType<typeof readState>) => ReturnType<typeof readState>) => {
    writeState(storage(), fn(readState(storage())));
  }, []);

  const show = useCallback(
    (kind: Kind): boolean => {
      const now = Date.now();
      const state = readState(storage());
      const ok = mayShow(kind, state, {
        now,
        standalone: isStandalone() || wasInstalled(),
        cardVisible: cardStateRef.current !== null || guideOpenRef.current,
        installShownThisPage: installShown.current,
        helpShownThisPage: helpShown.current,
      });
      if (!ok) return false;
      const probe = probePage(document);
      // No camera preview on screen, and the page itself has focus (a native file picker takes it away).
      const calm = readyToShow(probe) && !document.querySelector("video") && document.hasFocus();
      if (!calm) return false;
      if (kind === "help") {
        helpShown.current = true;
        save((s) => afterHelp(s, "shown", now));
      } else {
        installShown.current = true;
        save((s) => afterAnswer(s, "shown", now));
      }
      setCard({ kind, step: "ask" });
      return true;
    },
    [save],
  );

  // ---- signals -------------------------------------------------------------------------------------

  useEffect(() => {
    if (hiddenHere) return;
    const a = activity.current;
    const touch = () => {
      lastInteraction.current = Date.now();
    };
    const onFile = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (t && t.tagName === "INPUT" && t.type === "file" && t.files && t.files.length > 0) {
        a.taskStarted = true;
        // Someone just started work: any card about browsing goes away.
        if (cardStateRef.current && cardStateRef.current.kind !== "done") setCard(null);
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer && e.dataTransfer.files.length > 0) a.taskStarted = true;
    };
    const onComplete = () => {
      a.taskCompleted = true;
      doneAt.current = Date.now() + SHOW_DELAY_MS.done;
    };
    const onOut = (e: MouseEvent) => {
      const fine = window.matchMedia("(pointer: fine)").matches;
      if (!isExitIntent(e, fine)) return;
      if (browsingEngaged(a)) show("browse");
    };
    const events = ["pointermove", "pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;
    for (const ev of events) window.addEventListener(ev, touch, { passive: true, capture: true });
    document.addEventListener("change", onFile, true);
    document.addEventListener("drop", onDrop, true);
    document.addEventListener("mouseout", onOut);
    window.addEventListener(TASK_COMPLETE_EVENT, onComplete);
    touch();

    const timer = window.setInterval(() => {
      const now = Date.now();
      a.idleMs = now - lastInteraction.current;
      if (document.visibilityState === "visible" && document.hasFocus() && a.idleMs < 2500) a.activeMs += TICK_MS;

      if (doneAt.current !== null) {
        if (now - doneAt.current > DONE_WINDOW_MS) doneAt.current = null;
        else if (now >= doneAt.current && show("done")) doneAt.current = null;
        return;
      }
      if (unfinishedDue(a)) show("help");
      else if (browsingEngaged(a)) show("browse");
    }, TICK_MS);

    return () => {
      for (const ev of events) window.removeEventListener(ev, touch, { capture: true });
      document.removeEventListener("change", onFile, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("mouseout", onOut);
      window.removeEventListener(TASK_COMPLETE_EVENT, onComplete);
      window.clearInterval(timer);
    };
  }, [hiddenHere, show]);

  // Count distinct pages for "meaningful browsing"; a card from the previous page goes away.
  useEffect(() => {
    pages.current.add(pathname);
    activity.current.pages = pages.current.size;
  }, [pathname]);
  const [cardPath, setCardPath] = useState(pathname);
  if (cardPath !== pathname) {
    setCardPath(pathname);
    setCard(null);
  }

  // Already installed: stop asking, for good.
  useEffect(
    () =>
      subscribeInstall(() => {
        if (wasInstalled()) {
          save((s) => afterAnswer(s, "installed", Date.now()));
          setCard(null);
        }
      }),
    [save],
  );

  // Hide (not remove) while the card would sit on top of work or an advertisement.
  useEffect(() => {
    if (!card) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = cardRef.current;
      if (!el) return;
      const { width: w, height: h } = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const wide = vw >= 640;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
      const top = Math.max(0, headerBottom) + 12;
      setTopPx((prev) => (Math.abs(prev - top) < 1 ? prev : top));
      const cardLeft = wide ? 16 : 12;
      const rects: Record<Slot, { l: number; t: number; r: number; b: number } | null> = {
        bottom: wide ? { l: 16, t: vh - 16 - h, r: 16 + w, b: vh - 16 } : { l: 12, t: vh - 7.25 * rem - h, r: 12 + w, b: vh - 7.25 * rem },
        "top-left": { l: cardLeft, t: top, r: cardLeft + w, b: top + h },
        "top-right": wide ? { l: vw - 16 - w, t: top, r: vw - 16, b: top + h } : null,
      };
      const obstacles = [...document.querySelectorAll(OBSTACLES)]
        .filter((c) => !el.contains(c))
        .map((c) => c.getBoundingClientRect())
        .filter((b) => b.width > 0 && b.height > 0);
      const clear = (r: { l: number; t: number; r: number; b: number }) => !obstacles.some((b) => b.left < r.r && b.right > r.l && b.top < r.b && b.bottom > r.t);
      const chosen = SLOTS.find((name) => {
        const r = rects[name];
        return r !== null && clear(r);
      });
      if (chosen) setSlot((prev) => (prev === chosen ? prev : chosen));
      setCovering((prev) => (prev === !chosen ? prev : !chosen));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const t = window.setInterval(schedule, 500);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.clearInterval(t);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [card]);

  // ---- answers -------------------------------------------------------------------------------------

  const answer = useCallback(
    (a: Answer) => {
      save((s) => afterAnswer(s, a, Date.now()));
      setCard(null);
    },
    [save],
  );

  const dismissHelp = useCallback(() => {
    save((s) => afterHelp(s, "dismissed", Date.now()));
    setCard(null);
  }, [save]);

  const openGuide = useCallback(() => {
    save((s) => afterAnswer(s, "guideShown", Date.now()));
    setCard(null);
    setGuideOpen(true);
  }, [save]);

  const addToDevice = useCallback(async () => {
    // The browser's own prompt exists only in Chromium browsers, and only after the page has qualified; any
    // other case (Safari, iPhone, Firefox ...) gets the steps for that device instead.
    if (!canPrompt()) {
      openGuide();
      return;
    }
    const result = await promptInstall();
    if (result === "accepted") {
      save((s) => afterAnswer(s, "guideShown", Date.now()));
      setCard({ kind: "done", step: "yes", note: "Your browser is adding FreePDFScanner. We will not say it is done until it confirms." });
    } else if (result === "dismissed") {
      answer("maybeLater");
    } else {
      openGuide();
    }
  }, [answer, openGuide, save]);

  if (hiddenHere) return null;

  return (
    <>
      {card && (
        <div
          ref={cardRef}
          role="region"
          aria-label={card.kind === "help" ? "Help offer" : "Keep FreePDFScanner close"}
          data-install-card={card.kind}
          data-install-slot={slot}
          className={`card fixed z-30 p-4 text-sm shadow-xl ${SLOT_CLASS[slot]} ${covering ? "invisible" : ""}`}
          style={slot === "bottom" ? undefined : { top: topPx }}
        >
          <button type="button" onClick={() => (card.kind === "help" ? dismissHelp() : answer("closed"))} aria-label={card.kind === "help" ? "Dismiss" : "Close"} className="btn btn-ghost btn-icon absolute right-1 top-1">
            <Icon name="x" size={18} />
          </button>
          <div className="pr-8">
            <Body card={card} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Actions
              card={card}
              onYes={() => setCard({ kind: "done", step: "yes" })}
              onNotYet={() => answer("notYet")}
              onAdd={addToDevice}
              onShow={openGuide}
              onLater={() => answer("maybeLater")}
              onHelp={() => {
                dismissHelp();
                window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT));
              }}
              onKeepWorking={dismissHelp}
            />
          </div>
          {card.kind !== "help" && (card.step === "yes" || card.kind === "browse") && (
            <div className="mt-1 flex flex-wrap items-center gap-x-4">
              {card.step === "yes" && (
                <button type="button" onClick={() => answer("maybeLater")} className="inline-flex min-h-10 items-center text-xs font-medium underline underline-offset-2">
                  Maybe later
                </button>
              )}
              <button type="button" onClick={() => answer("never")} className="muted inline-flex min-h-10 items-center text-xs underline underline-offset-2">
                Don&apos;t remind me again
              </button>
            </div>
          )}
        </div>
      )}
      {guideOpen && <InstallGuide onClose={() => setGuideOpen(false)} />}
    </>
  );
}

function Body({ card }: { card: CardState }) {
  if (card.kind === "help") {
    return (
      <>
        <p className="font-semibold">Still working on your document?</p>
        <p className="muted mt-1">Need help finding a tool or finishing your task?</p>
      </>
    );
  }
  if (card.kind === "browse") {
    return (
      <>
        <p className="font-semibold">Keep FreePDFScanner close</p>
        <p className="muted mt-1">Save it to your Home Screen or computer for easier access next time.</p>
      </>
    );
  }
  if (card.step === "ask") {
    return <p className="font-semibold">Did you get everything done?</p>;
  }
  return (
    <>
      <p className="font-semibold">Great! Keep FreePDFScanner one tap away.</p>
      {card.note && <p className="muted mt-1">{card.note}</p>}
    </>
  );
}

interface Handlers {
  onYes: () => void;
  onNotYet: () => void;
  onAdd: () => void;
  onShow: () => void;
  onLater: () => void;
  onHelp: () => void;
  onKeepWorking: () => void;
}

function Actions({ card, ...h }: { card: CardState } & Handlers) {
  if (card.kind === "help") {
    return (
      <>
        <button type="button" onClick={h.onHelp} className="btn btn-primary">
          Show me how
        </button>
        <button type="button" onClick={h.onKeepWorking} className="btn btn-secondary">
          Keep working
        </button>
      </>
    );
  }
  if (card.kind === "browse") {
    return (
      <>
        <button type="button" onClick={h.onShow} className="btn btn-primary">
          Show me how
        </button>
        <button type="button" onClick={h.onLater} className="btn btn-secondary">
          Maybe later
        </button>
      </>
    );
  }
  if (card.step === "ask") {
    return (
      <>
        <button type="button" onClick={h.onYes} className="btn btn-primary">
          Yes, I&apos;m all set
        </button>
        <button type="button" onClick={h.onNotYet} className="btn btn-secondary">
          Not yet
        </button>
      </>
    );
  }
  return (
    <>
      <button type="button" onClick={h.onAdd} className="btn btn-primary">
        Add FreePDFScanner
      </button>
      <button type="button" onClick={h.onShow} className="btn btn-secondary">
        Show me how
      </button>
    </>
  );
}

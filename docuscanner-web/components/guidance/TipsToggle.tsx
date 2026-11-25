"use client";

// The Help tips switch in the header, next to the theme button: turns the contextual tips on or off
// at any time. It sits in the header's own row (not floating), so it never covers the page, and it
// stays on screen with the sticky header. The choice lives only in this browser (see
// utils/guidance/preferences.ts). The Ask me button is not affected by it.
//
// From 1024px wide it shows the bulb, "Help tips" and ON/OFF; narrower screens show the bulb and ON/OFF (the
// words would crowd the navigation or Log in / Sign up; screen readers still hear "Help tips").
//
// The server can't know the choice, so until React takes over both badges are in the HTML and
// CSS shows the right one from <html data-tips="on">, set before the first paint
// (TIPS_INIT_SCRIPT in hintStorage.ts). Nothing flips from OFF to ON after the page appears.

import { Icon } from "@/components/ui/icons";
import { useGuidance } from "./useGuidance";

export function TipsToggle() {
  const { hydrated, tips, setTips, turnOnAgain } = useGuidance();
  // ON whenever tips are allowed: chosen "on", or not chosen yet (a first-time visitor already gets
  // tips; see tipsAllowed in utils/guidance/preferences.ts). Only an explicit "off" is OFF.
  const on = tips !== "off";
  const label = on ? "Turn help tips off" : "Turn help tips on";
  return (
    <button
      type="button"
      data-assistant-id="tips-toggle"
      aria-pressed={hydrated ? on : undefined}
      title={hydrated ? label : "Help tips"}
      onClick={() => (on ? setTips("off") : turnOnAgain())}
      className="group flex min-h-11 shrink-0 items-center rounded-full"
    >
      <span className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-elevated px-2 text-sm font-medium text-fg shadow-sm transition-colors group-hover:bg-hover lg:px-3">
        <Icon name="bulb" size={18} className="text-amber-600 dark:text-amber-400" />
        <span className="sr-only lg:not-sr-only">Help tips</span>
        {hydrated ? (
          <span className={`tips-badge ${on ? "tips-badge-on" : "tips-badge-off"}`}>{on ? "ON" : "OFF"}</span>
        ) : (
          <>
            <span className="tips-badge tips-badge-on tips-prepaint-on">ON</span>
            <span className="tips-badge tips-badge-off tips-prepaint-off">OFF</span>
          </>
        )}
      </span>
    </button>
  );
}

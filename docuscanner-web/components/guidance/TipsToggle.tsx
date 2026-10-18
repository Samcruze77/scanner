"use client";

// Footer link to turn the contextual tips on or off again at any time. The choice lives only in this
// browser (see utils/guidance/preferences.ts). The Ask me button is not affected by it.

import { useGuidance } from "./useGuidance";

export function TipsToggle() {
  const { hydrated, tips, setTips, turnOnAgain } = useGuidance();
  const on = tips === "on";
  return (
    <button
      type="button"
      data-assistant-id="tips-toggle"
      aria-pressed={on}
      onClick={() => (on ? setTips("off") : turnOnAgain())}
      className="underline hover:no-underline"
    >
      {/* Server and first paint say the same thing, so nothing flickers. */}
      {hydrated && on ? "Turn help tips off" : "Turn help tips on"}
    </button>
  );
}

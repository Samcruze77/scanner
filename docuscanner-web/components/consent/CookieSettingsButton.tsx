"use client";

import { openConsentSettings } from "@/utils/consent/consent";

// Footer link that reopens the consent choices at any time.
export function CookieSettingsButton() {
  return (
    <button type="button" onClick={openConsentSettings} className="underline hover:no-underline">
      Cookie settings
    </button>
  );
}

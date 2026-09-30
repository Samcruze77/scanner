"use client";

// Microsoft Clarity (session recordings, heatmaps and Clarity's own behaviour
// analytics). It is loaded ONLY after the visitor has opted in to "Session
// recordings" in the consent banner (utils/consent/consent.ts) -- for every
// visitor, everywhere, not just where the law requires it -- which is the
// behaviour the Privacy Policy (section 7) describes. Before that, no Clarity
// script is requested and nothing is sent to Microsoft.
//
// Withdrawal: the script cannot be unloaded from a running page, so when the
// visitor turns recordings off the page reloads without it, and Clarity's
// first-party cookies are removed (purgeCategory("recordings")).
//
// Clarity's own Consent API v2 is called after load so Clarity knows consent
// was given (Microsoft requires an explicit signal for EEA/UK/CH visitors).
//
// The project ID is public by design (Clarity's snippet embeds it in page
// HTML); it is not a credential. If it is unset nothing loads. The separate,
// secret CLARITY_API_TOKEN (server-side reporting only) is never used here.
//
// Masking: pages that show a visitor's documents, extracted text, or account
// and sign-in forms carry data-clarity-mask="true" so their content is not
// captured in recordings.

import Script from "next/script";
import { useEffect, useState } from "react";
import { hasConsent, subscribeConsent } from "@/utils/consent/consent";

const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;

export function MicrosoftClarity() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sync = () => setAllowed(hasConsent("recordings"));
    sync();
    let wasAllowed = hasConsent("recordings");
    return subscribeConsent(() => {
      const now = hasConsent("recordings");
      if (wasAllowed && !now) {
        // Withdrawn: reload so the already-running script is gone.
        window.location.reload();
        return;
      }
      wasAllowed = now;
      setAllowed(now);
    });
  }, []);

  if (!CLARITY_PROJECT_ID || !allowed) return null;

  return (
    <Script id="microsoft-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", ${JSON.stringify(CLARITY_PROJECT_ID)});
      window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "granted" });`}
    </Script>
  );
}

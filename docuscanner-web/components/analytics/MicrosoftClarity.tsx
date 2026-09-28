// Microsoft Clarity: a secondary, complementary analytics source (session
// recordings, heatmaps, and Clarity's own country/region/city breakdowns)
// used to cross-check and validate this app's own analytics -- see
// utils/analytics/client.ts for the primary pipeline, which remains the
// source of truth for sessions, visitors, PDF jobs, tool usage, and ad
// metrics. Clarity is never queried server-side and this app never asks it
// for a visitor's IP address.
//
// Loads only when a project ID is configured. NEXT_PUBLIC_CLARITY_PROJECT_ID
// is intentionally public -- it's the same tracking ID Clarity's own script
// snippet embeds directly in page HTML, not a credential. If it's unset,
// nothing loads and nothing is fabricated: see the milestone report for
// exactly what's needed to turn this on.

import Script from "next/script";

const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;

export function MicrosoftClarity() {
  if (!CLARITY_PROJECT_ID) return null;

  return (
    <Script id="microsoft-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", ${JSON.stringify(CLARITY_PROJECT_ID)});`}
    </Script>
  );
}

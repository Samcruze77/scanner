// Ad slot placement type, shared between the Admin campaign UI
// (utils/admin/ads.ts, utils/admin/targetablePaths.ts) and the public
// delivery path (components/ads/AdSlot.tsx, utils/ads/eligible.ts). Real
// campaigns are served dynamically from public.ad_campaigns/ad_creatives
// via the `ads-eligible` Edge Function -- there is no static provider
// toggle anymore.

export type AdPlacement = "top" | "side" | "bottom" | "inline";

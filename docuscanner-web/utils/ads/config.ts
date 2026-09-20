// Advertising configuration. No ad provider is connected yet: every slot is a
// clearly labelled placeholder that reserves its space (so nothing jumps around
// later) and is never counted as an impression or click.
//
// To connect a provider later, set NEXT_PUBLIC_AD_PROVIDER (for example to
// "adsense") and render its tag inside AdSlot. Impression and click analytics
// switch on automatically for a live provider. They carry the placement and
// provider name only -- never document content.

export type AdPlacement = "top" | "side" | "bottom" | "inline";

export const AD_PROVIDER: string | null = process.env.NEXT_PUBLIC_AD_PROVIDER?.trim() || null;
export const ADS_LIVE = AD_PROVIDER !== null;

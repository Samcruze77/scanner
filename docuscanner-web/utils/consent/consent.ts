// Visitor consent for non-essential technologies -- the ONE place that decides
// whether analytics, ad measurement/ad video, or Clarity session recording may
// run. Everything non-essential asks `hasConsent(category)` and does nothing
// until the visitor has opted in (no pre-ticked choices, no implied consent).
//
// Categories (what each covers is stated on the banner and in /privacy):
//   analytics   -- FreePDFScanner's own usage analytics: anonymous visitor and
//                  session IDs, page/tool events, the live-presence signal, and
//                  the IP-based location lookup that goes with them.
//   advertising -- ad impression/click measurement, and third-party embedded
//                  ad video (YouTube / Vimeo), which may set their own cookies.
//   recordings  -- Microsoft Clarity session recordings and heatmaps.
//
// Strictly necessary storage is NOT covered here and needs no consent:
// sign-in cookies, the theme, saved signatures, and this consent choice itself.
//
// The choice lives in this browser's localStorage. Changing it dispatches an
// event so mounted components react immediately, and withdrawing a category
// deletes what that category had stored.

export const CONSENT_KEY = "ds_consent";
export const CONSENT_VERSION = 1;
export const CONSENT_EVENT = "ds-consent-change";
export const OPEN_CONSENT_EVENT = "ds-open-consent";

export const CONSENT_CATEGORIES = ["analytics", "advertising", "recordings"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export interface ConsentState {
  version: number;
  decided_at: string;
  analytics: boolean;
  advertising: boolean;
  recordings: boolean;
}

export type ConsentChoice = Record<ConsentCategory, boolean>;

// Identifiers written by the analytics category (see utils/analytics/identity.ts).
export const ANALYTICS_STORAGE_KEYS = ["ds_visitor_id", "ds_session_id", "ds_session_last_seen"] as const;
// First-party cookies Clarity sets on this site.
// sessionStorage keys written by the advertising category (frequency capping);
// matched by prefix, see utils/ads/eligible.ts.
export const ADVERTISING_SESSION_PREFIX = "ds_ad_";
export const CLARITY_COOKIES = ["_clck", "_clsk", "CLID", "ANONCHK", "SM", "MR"] as const;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function browserSession(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

// null = no valid decision yet (never asked, unreadable, or an older policy
// version that needs asking again).
export function readConsent(storage: StorageLike | null = browserStorage()): ConsentState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (parsed.version !== CONSENT_VERSION) return null;
    return {
      version: CONSENT_VERSION,
      decided_at: typeof parsed.decided_at === "string" ? parsed.decided_at : "",
      analytics: parsed.analytics === true,
      advertising: parsed.advertising === true,
      recordings: parsed.recordings === true,
    };
  } catch {
    return null;
  }
}

// Consent is opt-in: with no stored decision every category is off.
export function hasConsent(category: ConsentCategory, storage: StorageLike | null = browserStorage()): boolean {
  return readConsent(storage)?.[category] === true;
}

export const ACCEPT_ALL: ConsentChoice = { analytics: true, advertising: true, recordings: true };
export const REJECT_ALL: ConsentChoice = { analytics: false, advertising: false, recordings: false };

function deleteCookie(name: string) {
  const host = window.location.hostname;
  const domains = [undefined, host, `.${host}`, host.split(".").length > 2 ? `.${host.split(".").slice(-2).join(".")}` : undefined];
  for (const domain of domains) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain ? `; domain=${domain}` : ""}`;
  }
}

// Removes what a withdrawn category had stored on this device.
export function purgeCategory(category: ConsentCategory): void {
  if (typeof window === "undefined") return;
  if (category === "analytics") {
    for (const key of ANALYTICS_STORAGE_KEYS) {
      try {
        browserStorage()?.removeItem(key);
        browserSession()?.removeItem(key);
      } catch {
        /* storage unavailable */
      }
    }
  }
  if (category === "advertising") {
    try {
      const session = window.sessionStorage;
      for (const key of Object.keys(session)) if (key.startsWith(ADVERTISING_SESSION_PREFIX)) session.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
  if (category === "recordings") for (const name of CLARITY_COOKIES) deleteCookie(name);
}

export function writeConsent(choice: ConsentChoice, storage: StorageLike | null = browserStorage(), now: Date = new Date()): ConsentState {
  const previous = readConsent(storage);
  const state: ConsentState = { version: CONSENT_VERSION, decided_at: now.toISOString(), ...choice };
  try {
    storage?.setItem(CONSENT_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the choice applies to this page view only */
  }
  if (typeof window !== "undefined") {
    // Anything a declined/withdrawn category stored (including data from before this
    // banner existed) is removed.
    for (const category of CONSENT_CATEGORIES) if (!state[category] && previous?.[category] !== false) purgeCategory(category);
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: state }));
  }
  return state;
}

export function subscribeConsent(listener: (state: ConsentState | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => listener(readConsent());
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function openConsentSettings(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
}

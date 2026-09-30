"use client";

// Thin wrapper around this app's own `/api/analytics/track` Route Handler,
// which in turn proxies to the deployed `track-analytics` Supabase Edge
// Function. This is the ONLY place in the app that should call it -- keep
// every event funneled through here so the payload shape stays consistent.
//
// CONTRACT:
//   POST /api/analytics/track (same-origin)
//   body: {
//     event_name: string,        // one of the supported analytics events
//     visitor_id: string,        // anonymous id, see identity.ts
//     session_id: string,
//     path?: string,             // current pathname
//     referrer?: string,
//     properties?: object,       // free-form, non-sensitive extra data
//   }
//   success: HTTP 202 { ok: true }
//
// The Route Handler resolves the signed-in user id server-side from the SSR
// session cookie (not from anything this client sends) and attaches Vercel's
// real geolocation (country/region/city) before forwarding to Supabase --
// see utils/analytics/proxy.server.ts for why a same-origin proxy is needed
// for that. The client must NOT pass user_id or geo data itself.
//
// IP and User-Agent are NOT sent in the body -- they're already present on
// the raw HTTP request this browser makes to /api/analytics/track.
//
// Failure policy: every call here MUST fail silently. Analytics must never
// throw, block, or slow down the scanner/document workflows it's attached to.

import { hasConsent } from "@/utils/consent/consent";
import { getSessionId, getVisitorId } from "./identity";

export type AnalyticsEventType =
  | "page_view"
  | "app_open"
  | "signup_started"
  | "signup_completed"
  | "login"
  | "logout"
  | "scan_started"
  | "scan_completed"
  | "document_uploaded"
  | "document_created"
  | "conversion_started"
  | "conversion_completed"
  | "document_downloaded"
  | "feature_used"
  | "error";

export interface TrackEventOptions {
  conversionType?: string;
  properties?: Record<string, unknown>;
}

// Where the visitor came from, without anything after the path. A page opened from an
// emailed link can have a referrer that carries a one-time token in its query
// string, and that must never be stored.
function safeReferrer(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const url = new URL(document.referrer);
    return url.origin + url.pathname;
  } catch {
    return undefined;
  }
}

export async function trackEvent(
  eventName: AnalyticsEventType,
  options: TrackEventOptions = {},
): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    // No analytics without the visitor's opt-in (see utils/consent/consent.ts).
    if (!hasConsent("analytics")) return;

    const properties: Record<string, unknown> = { ...options.properties };
    if (options.conversionType) properties.conversion_type = options.conversionType;

    const body = {
      event_name: eventName,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      path: window.location.pathname,
      referrer: safeReferrer(),
      properties: Object.keys(properties).length > 0 ? properties : undefined,
    };

    await fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // Silently ignored by design -- see failure policy above.
  }
}

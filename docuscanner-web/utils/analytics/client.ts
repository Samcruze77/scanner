"use client";

// Thin wrapper around the deployed `track-analytics` Supabase Edge Function.
// This is the ONLY place in the app that should call it -- keep every event
// funneled through here so the payload shape stays consistent.
//
// VERIFIED LIVE CONTRACT (confirmed against the deployed function):
//   POST {SUPABASE_URL}/functions/v1/track-analytics
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
// The edge function itself derives the authenticated user id from the
// Supabase JWT on the Authorization header (attached automatically by
// supabase-js) and writes it to analytics_events.user_id server-side --
// the client must NOT also pass it in properties, that would duplicate an
// identity the backend already has from a source it trusts more.
//
// IP and User-Agent are NOT sent in the body -- they're already present on
// the raw HTTP request the browser makes to the edge function.
//
// Failure policy: every call here MUST fail silently. Analytics must never
// throw, block, or slow down the scanner/document workflows it's attached to.

import { createClient } from "@/utils/supabase/client";
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

export async function trackEvent(
  eventName: AnalyticsEventType,
  options: TrackEventOptions = {},
): Promise<void> {
  try {
    if (typeof window === "undefined") return;

    const supabase = createClient();

    const properties: Record<string, unknown> = { ...options.properties };
    if (options.conversionType) properties.conversion_type = options.conversionType;

    const body = {
      event_name: eventName,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      path: window.location.pathname,
      referrer: document.referrer || undefined,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
    };

    await supabase.functions.invoke("track-analytics", { body });
  } catch {
    // Silently ignored by design -- see failure policy above.
  }
}

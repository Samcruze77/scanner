"use client";

// Mounted once in the root layout. Posts a lightweight presence heartbeat
// every 30s while the tab is visible so Admin's Live view can show who's
// online -- guests included, via the same visitor/session identity
// analytics already uses (utils/analytics/identity.ts). Pauses entirely
// when the tab is hidden (Page Visibility API) and sends one heartbeat
// immediately on becoming visible again, rather than polling in the
// background. Renders nothing, and every request is fire-and-forget:
// presence must never block or slow down the page.

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getSessionId, getVisitorId, markActivity, peekSessionId } from "@/utils/analytics/identity";
import { hasConsent, subscribeConsent } from "@/utils/consent/consent";
import { mayTrack } from "@/utils/analytics/audience";
import { useAudience } from "@/components/analytics/useAudience";

const HEARTBEAT_MS = 30_000;

// Best-effort, coarse label from the URL alone -- not a claim about what's
// actually happening inside the tool (e.g. "scanning" vs "idle"). Deeper,
// per-tool activity state isn't wired through yet; see the final report.
function toolFromPath(path: string): string | null {
  const toolMatch = path.match(/^\/tools\/([^/]+)/);
  if (toolMatch) return toolMatch[1];
  const convertMatch = path.match(/^\/convert\/([^/]+)/);
  if (convertMatch) return convertMatch[1];
  if (path === "/scan" || path.startsWith("/scan?")) return "scanner";
  return null;
}

// `activity` heartbeats (page load, tab becoming visible again) count as the visitor being
// present and may start/refresh the session. Interval heartbeats are only a pulse: they
// report the session while it is live and never extend it (see peekSessionId).
async function sendHeartbeat(path: string, activity = false) {
  try {
    const visitorId = getVisitorId();
    const sessionId = activity ? getSessionId() : peekSessionId();
    if (!visitorId || !sessionId) return;

    await fetch("/api/analytics/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        visitor_id: visitorId,
        path,
        tool: toolFromPath(path),
        activity: "browsing",
      }),
      keepalive: true,
    });
  } catch {
    // Presence must never surface an error to the user.
  }
}

export function PresenceHeartbeat() {
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // No presence until the administrator check has settled; none for administrators.
  const trackable = mayTrack(useAudience());

  useEffect(() => {
    function start() {
      // Presence needs "analytics" consent (utils/consent/consent.ts).
      if (timer.current || !trackable || !hasConsent("analytics")) return;
      void sendHeartbeat(pathname || "/", true);
      timer.current = setInterval(() => void sendHeartbeat(pathname || "/"), HEARTBEAT_MS);
    }
    function stop() {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    // Consent granted mid-visit starts presence at once; withdrawn stops it.
    const unsubscribe = subscribeConsent(() => {
      if (trackable && hasConsent("analytics") && document.visibilityState === "visible") start();
      else stop();
    });

    // Real interaction keeps a session alive (and begins a new one after 30 idle minutes).
    function onActivity() {
      if (!trackable || document.visibilityState !== "visible") return;
      const wasLive = peekSessionId() !== null;
      markActivity();
      if (!wasLive && peekSessionId() !== null) void sendHeartbeat(pathname || "/");
    }
    const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true, capture: true });

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [pathname, trackable]);

  return null;
}

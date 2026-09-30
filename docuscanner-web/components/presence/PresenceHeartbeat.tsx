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
import { getSessionId, getVisitorId } from "@/utils/analytics/identity";
import { hasConsent, subscribeConsent } from "@/utils/consent/consent";

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

async function sendHeartbeat(path: string) {
  try {
    const visitorId = getVisitorId();
    const sessionId = getSessionId();
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

  useEffect(() => {
    function start() {
      // Presence needs "analytics" consent (utils/consent/consent.ts).
      if (timer.current || !hasConsent("analytics")) return;
      void sendHeartbeat(pathname || "/");
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
      if (hasConsent("analytics") && document.visibilityState === "visible") start();
      else stop();
    });

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stop();
    };
  }, [pathname]);

  return null;
}

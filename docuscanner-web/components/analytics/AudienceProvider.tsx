"use client";

// Works out, once the sign-in state is known, whether this browser belongs to an
// administrator, and publishes the answer to utils/analytics/audience.ts. Mounted inside
// AuthProvider. Until it settles the state stays "pending" and nothing is tracked, so an
// administrator never produces a first event or a Clarity recording before the check.
//
//   guest                       -> "visitor" at once (no request, nothing to look up)
//   signed in                   -> asks /api/analytics/audience (server-verified role)
//   check cannot be completed   -> "unverified" (events still go to the server, which
//                                  excludes administrators itself; Clarity stays off)
//
// A positive/negative answer is remembered for this tab for a few minutes, per user id,
// to avoid a request on every page load. It holds no role detail beyond yes/no.

import { useEffect } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { setAudience } from "@/utils/analytics/audience";

const CACHE_PREFIX = "ds_audience:";
const CACHE_MS = 10 * 60 * 1000;

function readCache(userId: string): boolean | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { excluded?: unknown; at?: unknown };
    if (typeof parsed.excluded !== "boolean" || typeof parsed.at !== "number") return null;
    return Date.now() - parsed.at < CACHE_MS ? parsed.excluded : null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, excluded: boolean) {
  try {
    window.sessionStorage.setItem(CACHE_PREFIX + userId, JSON.stringify({ excluded, at: Date.now() }));
  } catch {
    /* private mode: the check just repeats on the next page load */
  }
}

export function AudienceProvider() {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (loading) {
      setAudience("pending");
      return;
    }
    if (!userId) {
      setAudience("visitor");
      return;
    }
    const cached = readCache(userId);
    if (cached !== null) {
      setAudience(cached ? "excluded" : "visitor");
      return;
    }

    setAudience("pending");
    let cancelled = false;
    fetch("/api/analytics/audience", { cache: "no-store", credentials: "same-origin" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { excluded?: unknown };
        if (typeof body.excluded !== "boolean") throw new Error("bad answer");
        return body.excluded;
      })
      .then((excluded) => {
        if (cancelled) return;
        writeCache(userId, excluded);
        setAudience(excluded ? "excluded" : "visitor");
      })
      .catch(() => {
        if (!cancelled) setAudience("unverified");
      });
    return () => {
      cancelled = true;
    };
  }, [loading, userId]);

  return null;
}

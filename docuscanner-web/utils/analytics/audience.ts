// Whether this browser's visits count as visitor analytics, as far as the page can know.
// Pure state + subscriptions (no React, no I/O) so it is shared by the tracking code,
// the presence heartbeat and the Microsoft Clarity loader, and can be unit-tested.
//
//   pending     auth state / role check not finished: send NOTHING yet (an administrator
//               must not produce a first event before the check completes)
//   visitor     a guest, or a signed-in non-administrator: tracked as usual
//   excluded    a verified administrator (decided by the server, never by this client)
//   unverified  signed in but the role check could not be completed: first-party events are
//               still sent (the server excludes administrators itself, so nothing is lost
//               or leaked), but Clarity is NOT loaded because only the browser can stop it
//
// This state is a convenience for NOT sending/recording in the browser. The authoritative
// exclusion for first-party analytics lives on the server (supabase/functions/_shared/
// adminTraffic.ts); a client that lies about its own state only changes its own browser.

export type Audience = "pending" | "visitor" | "excluded" | "unverified";

let current: Audience = "pending";
const listeners = new Set<() => void>();

export function getAudience(): Audience {
  return current;
}

export function setAudience(next: Audience): void {
  if (next === current) return;
  current = next;
  for (const l of [...listeners]) l();
}

export function subscribeAudience(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// First-party events and presence are allowed once the audience is settled and not excluded.
export function mayTrack(audience: Audience = current): boolean {
  return audience === "visitor" || audience === "unverified";
}

// Resolves with whether tracking is allowed, waiting (up to timeoutMs) for the audience to
// settle. Still pending after the timeout means "do not track": fail closed.
export function whenTrackingAllowed(timeoutMs = 5000): Promise<boolean> {
  if (current !== "pending") return Promise.resolve(mayTrack());
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeAudience(() => {
      if (current === "pending") return;
      if (timer) clearTimeout(timer);
      unsubscribe();
      resolve(mayTrack());
    });
    timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, timeoutMs);
  });
}

// Test hook.
export function resetAudienceForTests(): void {
  current = "pending";
  listeners.clear();
}

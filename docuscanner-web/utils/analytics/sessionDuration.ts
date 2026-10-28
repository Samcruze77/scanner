// Session length as the admin panel shows it: the time between a session's first and last
// recorded heartbeat (live_sessions.started_at -> last_seen), i.e. elapsed wall-clock time
// while the visitor was present, NOT an arbitrary cap and NOT a sum across sessions.
//
// A session is one live_sessions row (one session_id). The browser starts a new session_id
// after 30 minutes without user activity (utils/analytics/identity.ts), and background
// heartbeats do not count as activity, so a long-lived row means genuinely continuous use.
// A genuine session of any length (including more than 72 hours) is reported as it is.
//
// Missing or unparseable timestamps give null (shown as "Unknown"), never 0 and never a
// guess. A last_seen earlier than started_at by up to CLOCK_SKEW_MS is the Edge Function's
// clock disagreeing with the database's by a few seconds (rows written before the two
// were stamped together) and counts as 0; anything beyond that is invalid -> null.

export const CLOCK_SKEW_MS = 10_000;

function toMs(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (value === "") return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function sessionDurationSeconds(startedAt: unknown, lastSeen: unknown): number | null {
  const start = toMs(startedAt);
  const end = toMs(lastSeen);
  if (start === null || end === null) return null;
  const diff = end - start;
  if (diff < 0) return diff >= -CLOCK_SKEW_MS ? 0 : null;
  return Math.floor(diff / 1000);
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ${minutes % 60}m`;
}

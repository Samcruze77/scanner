// Plain-language messages for authentication failures, and the short codes that
// are safe to send to analytics. Two rules shape every message here:
//  - it never says whether an email address has an account (log-in and reset
//    say the same thing whoever the address belongs to);
//  - it never includes anything the person typed. Codes (never messages, emails
//    or passwords) are all that reach analytics.

export type AuthContext = "login" | "signup" | "reset_request" | "reset_update";

interface AuthErrorLike {
  code?: string;
  name?: string;
  status?: number;
  message?: string;
}

function asAuthError(error: unknown): AuthErrorLike {
  return typeof error === "object" && error !== null ? (error as AuthErrorLike) : {};
}

export const GENERIC_AUTH_ERROR = "Something went wrong. Please try again.";

// A short, content-free code for analytics.
export function authErrorCode(error: unknown, fallback: string): string {
  const e = asAuthError(error);
  return e.code || (e.status ? `http_${e.status}` : e.name) || fallback;
}

export function isRateLimited(error: unknown): boolean {
  const e = asAuthError(error);
  return e.status === 429 || e.code === "over_request_rate_limit" || e.code === "over_email_send_rate_limit";
}

// The recovery session is gone or was never valid (link expired or used up).
export function isSessionMissing(error: unknown): boolean {
  const e = asAuthError(error);
  return e.name === "AuthSessionMissingError" || e.code === "session_not_found" || e.code === "no_authorization" || e.status === 401;
}

export function authErrorMessage(error: unknown, context: AuthContext): string {
  const e = asAuthError(error);
  if (isRateLimited(error)) return "Too many attempts. Please wait a few minutes and try again.";
  if (e.name === "AuthRetryableFetchError" || e.status === 0) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  switch (e.code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Please confirm your email address first. Check your inbox for the confirmation link.";
    case "user_already_exists":
    case "email_exists":
      // Same wording whether or not the address has an account.
      return "We couldn't create that account. If you already have one, log in or use \"Forgot password?\".";
    case "weak_password":
      // The server's own explanation (for example a known-leaked password) is safe to show.
      return e.message || "Please choose a stronger password.";
    case "same_password":
      return "Your new password must be different from your current one.";
    case "email_address_invalid":
    case "validation_failed":
      return context === "reset_update" ? GENERIC_AUTH_ERROR : "Enter a valid email address, like name@example.com.";
    default:
      return GENERIC_AUTH_ERROR;
  }
}

// One set of rules for emails and passwords, used by the sign-up form and the
// password-reset form so they can never disagree. Pure functions: no
// password ever leaves these helpers except as a yes/no problem message, and
// nothing here logs, stores or sends anything.
//
// Log-in deliberately does NOT apply the strength rules: someone whose
// existing password is shorter than today's minimum must still be able to
// sign in (and then choose a stronger one through "Forgot password?").

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt (which Supabase uses) only reads the first 72 bytes, so a longer
// password would be silently cut short. Refuse it instead.
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters.`;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// The message to show, or null when the email looks fine. Only a format check:
// whether an account exists is never something the app tells anyone.
export function emailProblem(value: string): string | null {
  const email = value.trim();
  if (email.length === 0) return "Enter your email address.";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) return "Enter a valid email address, like name@example.com.";
  return null;
}

// Rules for a NEW password (sign-up, reset).
export function passwordProblem(password: string): string | null {
  if (password.length === 0) return "Enter a password.";
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return `Use ${PASSWORD_MAX_BYTES} characters or fewer.`;
  return null;
}

export function confirmProblem(password: string, confirmation: string): string | null {
  if (confirmation.length === 0) return "Type your password again to confirm it.";
  if (confirmation !== password) return "The two passwords don't match.";
  return null;
}

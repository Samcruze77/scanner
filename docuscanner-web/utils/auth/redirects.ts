// Where the links in authentication emails send the person back to. One place, so
// the sign-up confirmation and the password-reset link can't drift apart.
//
// The address is the one the app is running on: production sign-up gives
// https://scanner-five-mocha.vercel.app, local development gives
// http://localhost:3000. Nothing is hardcoded, and no environment variable is
// needed. Supabase only honours an address that is in the project's Redirect URLs
// allow-list (Authentication > URL Configuration); anything else, such as a
// preview deployment, falls back to the project's Site URL.

// `path` starts with "/" ("" means the site's home page).
export function authRedirectUrl(path = ""): string {
  return `${window.location.origin}${path}`;
}

// Unit tests for the consent module (utils/consent/consent.ts) with a fake
// browser environment, and a static audit that the Privacy Policy's promises
// about cookies, analytics, advertising and Microsoft Clarity are what the
// code actually does. The end-to-end browser check is tests/consent/browser.mjs.
//
// Run: node tests/consent/consent.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

// ---- minimal browser fake --------------------------------------------------
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const api = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    keys: () => [...map.keys()],
  };
  return new Proxy(api, { ownKeys: () => [...map.keys()], getOwnPropertyDescriptor: (t, k) => (map.has(k) ? { enumerable: true, configurable: true, value: map.get(k) } : Object.getOwnPropertyDescriptor(t, k)), get: (t, k) => (k in t ? t[k] : map.get(k)) });
}
const events = [];
const cookieWrites = [];
const local = fakeStorage();
const session = fakeStorage();
globalThis.window = {
  localStorage: local,
  sessionStorage: session,
  location: { hostname: "www.example.test" },
  dispatchEvent: (e) => void events.push(e.type),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.document = { set cookie(v) { cookieWrites.push(v); } };

const c = await import("../../utils/consent/consent.ts");

console.log("1. Opt-in by default");
{
  check("no decision => null", c.readConsent(local) === null);
  check("every category off with no decision", c.CONSENT_CATEGORIES.every((cat) => c.hasConsent(cat, local) === false));
  check("accept-all preset is all true, reject-all all false", Object.values(c.ACCEPT_ALL).every(Boolean) && Object.values(c.REJECT_ALL).every((v) => v === false));
}

console.log("2. Storing and reading a choice");
{
  const s = c.writeConsent({ analytics: true, advertising: false, recordings: false }, local, new Date("2026-09-30T10:00:00Z"));
  check("version + timestamp stored", s.version === c.CONSENT_VERSION && s.decided_at === "2026-09-30T10:00:00.000Z");
  check("only the chosen category is on", c.hasConsent("analytics", local) && !c.hasConsent("advertising", local) && !c.hasConsent("recordings", local));
  check("change event dispatched", events.includes(c.CONSENT_EVENT));
  local.setItem(c.CONSENT_KEY, "{not json");
  check("corrupt value => treated as no consent", c.readConsent(local) === null && !c.hasConsent("analytics", local));
  local.setItem(c.CONSENT_KEY, JSON.stringify({ version: 999, analytics: true, advertising: true, recordings: true }));
  check("older/newer policy version => asked again, nothing assumed", c.readConsent(local) === null && !c.hasConsent("recordings", local));
  local.setItem(c.CONSENT_KEY, JSON.stringify({ version: c.CONSENT_VERSION, analytics: "yes", advertising: 1, recordings: null }));
  check("only literal true counts", !c.hasConsent("analytics", local) && !c.hasConsent("advertising", local));
  check("unavailable storage => no consent", c.readConsent(null) === null && c.hasConsent("analytics", null) === false);
}

console.log("3. Declining or withdrawing deletes what the category stored");
{
  local.setItem("ds_visitor_id", "v");
  local.setItem("ds_session_last_seen", "1");
  session.setItem("ds_session_id", "s");
  session.setItem("ds_ad_seen_camp1", "2");
  session.setItem("unrelated", "keep");
  cookieWrites.length = 0;
  c.writeConsent(c.ACCEPT_ALL, local); // a visitor who had opted in ...
  local.setItem("ds_visitor_id", "v");
  local.setItem("ds_session_last_seen", "1");
  session.setItem("ds_session_id", "s");
  session.setItem("ds_ad_seen_camp1", "2");
  cookieWrites.length = 0;
  c.writeConsent(c.REJECT_ALL, local); // ... then withdraws
  check("visitor + session identifiers removed", local.getItem("ds_visitor_id") === null && local.getItem("ds_session_last_seen") === null && session.getItem("ds_session_id") === null);
  check("ad frequency-cap storage removed", session.getItem("ds_ad_seen_camp1") === null);
  check("unrelated storage untouched", session.getItem("unrelated") === "keep");
  check("Clarity cookies expired", ["_clck", "_clsk"].every((n) => cookieWrites.some((w) => w.startsWith(`${n}=;`) && /expires=Thu, 01 Jan 1970/.test(w))));
  // A later opt-in then opt-out purges again; keeping a granted category does not purge it.
  c.writeConsent({ analytics: true, advertising: false, recordings: false }, local);
  local.setItem("ds_visitor_id", "v2");
  c.writeConsent({ analytics: true, advertising: true, recordings: false }, local);
  check("still-granted category is not purged", local.getItem("ds_visitor_id") === "v2");
  c.writeConsent({ analytics: false, advertising: true, recordings: false }, local);
  check("withdrawing analytics removes the visitor id", local.getItem("ds_visitor_id") === null);
}

// ---- static audit of the code against the Privacy Policy --------------------
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const source = [...walk("app"), ...walk("components"), ...walk("utils")].filter((f) => /\.(ts|tsx)$/.test(f));

console.log("4. Policy s.7: Clarity is loaded only after opt-in, for every visitor");
{
  const clarity = read("components/analytics/MicrosoftClarity.tsx");
  check("script is rendered only when consent is present", /if \(!CLARITY_PROJECT_ID \|\| !allowed\) return null/.test(clarity) && /hasConsent\("recordings"\)/.test(clarity));
  check("initial state is 'not allowed' (nothing loads before the stored choice is read)", /useState\(false\)/.test(clarity));
  check("withdrawal reloads the page so the running script is gone", /window\.location\.reload\(\)/.test(clarity));
  check("Clarity's consent API is signalled", /clarity\("consentv2"/.test(clarity));
  check("no region check that could skip the prompt", !/EEA|GDPR|country|geolocation/i.test(clarity.replace(/\/\/.*$/gm, "")));
  const tagUsers = source.filter((f) => read(f).includes("clarity.ms/tag"));
  check("the Clarity tag URL exists in exactly one file", tagUsers.length === 1 && tagUsers[0].endsWith("MicrosoftClarity.tsx"), tagUsers.join());
  check("Clarity is mounted once, in the root layout", (read("app/layout.tsx").match(/<MicrosoftClarity \/>/g) ?? []).length === 1);
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check("Clarity's API token is not read by client code (UI hint text aside)", !source.filter((f) => read(f).startsWith('"use client"')).some((f) => /process\.env\.CLARITY_API_TOKEN/.test(stripComments(read(f)))));
}

console.log("5. Policy s.6 / s.4: analytics identifiers and events need opt-in");
{
  const id = read("utils/analytics/identity.ts");
  check("visitor id gated", /getVisitorId\(\): string \| null \{\s*if \(typeof window === "undefined" \|\| !hasConsent\("analytics"\)\) return null/.test(id));
  check("session id gated", /getSessionId\(\): string \| null \{\s*if \(typeof window === "undefined" \|\| !hasConsent\("analytics"\)\) return null/.test(id));
  check("app_open detection gated", /isNewSessionThisPageLoad\(\): boolean \{\s*if \(typeof window === "undefined" \|\| !hasConsent\("analytics"\)\) return false/.test(id));
  check("trackEvent sends nothing without consent", /if \(!hasConsent\("analytics"\)\) return;/.test(read("utils/analytics/client.ts")));
  const hb = read("components/presence/PresenceHeartbeat.tsx");
  check("presence heartbeat needs the ids (which need consent)", /if \(!visitorId \|\| !sessionId\) return;/.test(hb));
  check("presence starts/stops as consent changes", /subscribeConsent/.test(hb) && /!hasConsent\("analytics"\)\) return;/.test(hb));
  check("page views only count with consent", /if \(!hasConsent\("analytics"\)\) return;/.test(read("components/analytics/AnalyticsListener.tsx")));
  const routes = ["track", "heartbeat", "ad-event"].map((n) => read(`app/api/analytics/${n}/route.ts`)).join("\n");
  check("IP-based location enrichment only runs inside the analytics routes (i.e. after consent)", (routes.match(/enrichRequestGeo/g) ?? []).length >= 3);
}

console.log("6. Policy s.8: advertising storage, measurement and embeds need opt-in");
{
  const ads = read("utils/ads/eligible.ts");
  check("ad impression/click events gated", /async function sendAdEvent[\s\S]{0,200}if \(!hasConsent\("advertising"\)\) return;/.test(ads));
  check("frequency-cap storage gated (read and write)", /function impressionCount[\s\S]{0,120}hasConsent\("advertising"\)/.test(ads) && /function recordImpressionLocally[\s\S]{0,120}hasConsent\("advertising"\)/.test(ads));
  const slot = read("components/ads/AdSlot.tsx");
  check("third-party video embeds render only with consent", /useConsent\("advertising"\)/.test(slot) && /!adsConsent \?/.test(slot));
}

console.log("7. Every browser storage key is classified (new storage must be reviewed)");
{
  const ESSENTIAL = ["pdfscanner.theme", "docuscanner.signature.v1", "ds_consent", "ds_password_recovery"];
  const ANALYTICS = ["ds_visitor_id", "ds_session_id", "ds_session_last_seen"];
  const ADVERTISING = ["ds_ad_seen_", "ds_ad_"];
  // Not browser storage (font-name marker in the DOCX converter).
  const NOT_STORAGE = ["@"];
  const known = new Set([...ESSENTIAL, ...ANALYTICS, ...ADVERTISING, ...NOT_STORAGE]);
  const found = new Set();
  for (const f of source) {
    const text = read(f);
    for (const m of text.matchAll(/(?:const|let)\s+[A-Z_]*(?:KEY|PREFIX)[A-Z_]*\s*=\s*"([^"]+)"/g)) found.add(m[1]);
  }
  const unclassified = [...found].filter((k) => !known.has(k));
  check("no unclassified storage keys", unclassified.length === 0, unclassified.join());
  const hint = read("components/guidance/Hint.tsx");
  check("hint dismissals are device-local functional preferences (never sent)", /localStorage only; never sent anywhere/.test(hint));
  check("no first-party cookies are set by app code", !source.filter((f) => !f.startsWith("utils/consent")).some((f) => /document\.cookie\s*=/.test(read(f))));
}

console.log("8. Banner behaviour");
{
  const banner = read("components/consent/ConsentBanner.tsx");
  check("Reject is offered next to Accept, same button size", /Accept all[\s\S]*Reject non-essential/.test(banner) && (banner.match(/className="btn btn-(primary|secondary)"/g) ?? []).length >= 2);
  check("nothing pre-ticked: choices start from reject-all", /useState<ConsentChoice>\(REJECT_ALL\)/.test(banner));
  check("banner is never server-rendered (assumes 'decided' on the server)", /\(\) => true,\s*\)/.test(banner));
  check("each optional category is separately switchable", ["analytics", "advertising", "recordings"].every((k) => new RegExp(`key: "${k}"`).test(banner)));
  check("footer offers Cookie settings and the Privacy Policy", /CookieSettingsButton/.test(read("components/layout/Footer.tsx")) && /href="\/privacy"/.test(read("components/layout/Footer.tsx")));
  check("banner links to the cookies section of the policy", /\/privacy#section-6/.test(banner) && /id=\{`section-\$\{parseInt\(section\.title, 10\)\}`\}/.test(read("app/privacy/page.tsx")));
  check("banner is mounted in the root layout", /<ConsentBanner \/>/.test(read("app/layout.tsx")));
}

console.log("9. Policy s.7: sensitive content is masked from Clarity recordings");
{
  check("workflow pages (documents, OCR text) masked", /maskRecordings = ads === "workflow"/.test(read("components/layout/PageShell.tsx")) && /data-clarity-mask=/.test(read("components/layout/PageShell.tsx")));
  check("sign-in / sign-up dialog masked", /data-clarity-mask="true"/.test(read("components/auth/AuthModal.tsx")));
  check("account page masked", /maskRecordings/.test(read("app/account/page.tsx")));
  check("saved-documents history masked", (read("app/history/page.tsx").match(/maskRecordings/g) ?? []).length >= 2);
}

console.log("10. Account deletion and the 24-hour re-signup rule");
{
  const fn = read("supabase/functions/delete-account/index.ts");
  check("acts only on the verified caller (never an id from the request)", /const userId = ctx\.userClaims\?\.id/.test(fn) && !/body\.(user_id|id)\b/.test(fn));
  check("requires typed confirmation", /body\.confirm !== "DELETE"/.test(fn));
  check("refuses active admin accounts", /adminRow\?\.is_active/.test(fn) && /403/.test(fn));
  check("removes stored documents before the account", fn.indexOf('storage.from("documents").remove') < fn.indexOf("auth.admin.deleteUser"));
  check("records the cool-down hash before deleting, and undoes it if deletion fails", fn.indexOf("deleted_account_cooldowns\").upsert") < fn.indexOf("auth.admin.deleteUser") && /delete\(\)\.eq\("email_hash", hash\)/.test(fn));
  check("stores only a one-way hash, never the address", !/email_hash: email/.test(fn) && /crypto\.subtle\.digest\("SHA-256"/.test(fn));
  const mig = read("supabase/migrations/20260930130000_account_deletion_cooldown.sql");
  check("cool-down table is RLS-protected with no client access", /enable row level security/.test(mig) && /revoke all on table public\.deleted_account_cooldowns from public, anon, authenticated/.test(mig));
  check("24 hours, enforced by a BEFORE INSERT trigger on auth.users", /interval '24 hours'/.test(mig) && /before insert on auth\.users/.test(mig));
  check("SQL and function hash the same way (sha256 of lower(trim(email)))", /sha256\(convert_to\(lower\(btrim\(address\)\)/.test(mig) && /trim\(\)\.toLowerCase\(\)/.test(fn));
  check("helper functions are not callable by browsers", /revoke all on function public\.signup_email_in_cooldown\(text\) from public, anon, authenticated/.test(mig));
  const panel = read("components/account/DeleteAccountPanel.tsx");
  check("the note about signing up again is shown next to the button", /you can sign up again with the same email at any time after 24 hours/.test(panel));
  check("delete needs the exact word DELETE", /confirm !== "DELETE"/.test(panel) && /disabled=\{busy \|\| confirm !== "DELETE"\}/.test(panel));
  check("signs the user out after deletion", /auth\.signOut\(\)/.test(panel));
  check("account page reachable from the account menu", /href="\/account"/.test(read("components/auth/AccountMenu.tsx")));
  const modal = read("components/auth/AuthModal.tsx");
  check("sign-up explains the cool-down before calling the auth API", modal.indexOf("/api/auth/signup-check") < modal.indexOf("supabase.auth.signUp"));
  const route = read("app/api/auth/signup-check/route.ts");
  check("pre-check answers one boolean, is rate limited, and uses the server-side key only", /rateLimited\(/.test(route) && /blocked/.test(route) && !/NEXT_PUBLIC_SUPABASE_SECRET/.test(route));
  check("page is not indexed", /privateMetadata/.test(read("app/account/page.tsx")));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

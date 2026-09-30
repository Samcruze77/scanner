// The Admin Profile export is DERIVED from the real profile rows, not from a
// hand-kept column list. This test compares the live-schema snapshot
// (supabase/schema/admin-profile.columns.json: public.admin_users,
// public.user_profiles, auth.users) with the export mapping and fails when a
// non-sensitive column is omitted -- including one added later.
//
// Run: node tests/analytics/admin-profile.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXCLUDED_AUTH_FIELDS, SECRET_NAME, buildAdminProfile } from "../../supabase/functions/_shared/adminProfile.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(here, "../../supabase/schema/admin-profile.columns.json"), "utf8"));

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

// A row with EVERY snapshot column populated with a recognisable value.
const fill = (cols) => Object.fromEntries(cols.map((c) => [c, `v:${c}`]));
const adminRow = fill(schema["public.admin_users"]);
const userProfileRow = fill(schema["public.user_profiles"]);
const authUser = fill(schema["auth.users"]);
// raw_user_meta_data is an object in reality.
authUser.raw_user_meta_data = { full_name: "Ada Admin", avatar_url: "https://x.test/a.png", locale: "en", timezone: "UTC", access_token: "SECRET", nested: { a: 1 } };
authUser.raw_app_meta_data = { provider: "email", providers: ["email"] };

const profile = buildAdminProfile({ adminRow, userProfileRow, authUser });
const keys = Object.keys(profile);
const values = Object.values(profile).map(String).join("\n");

console.log("1. Every admin_users column is exported (admin_<column>)");
for (const c of schema["public.admin_users"]) {
  const secret = SECRET_NAME.test(c);
  check(`admin_users.${c}`, secret ? !keys.includes(`admin_${c}`) : keys.includes(`admin_${c}`), keys.join());
}

console.log("2. Every user_profiles column is exported (profile_<column>), user_id being the join key");
for (const c of schema["public.user_profiles"]) {
  if (c === "user_id") continue; // identical to admin_user_id
  check(`user_profiles.${c}`, keys.includes(`profile_${c}`));
}

console.log("3. Every auth.users column is either exported or explicitly excluded with a reason");
for (const c of schema["auth.users"]) {
  const exported = keys.includes(`account_${c}`);
  const excluded = c in EXCLUDED_AUTH_FIELDS || SECRET_NAME.test(c);
  check(`auth.users.${c} is exported XOR excluded`, exported !== excluded, `exported=${exported} excluded=${excluded}`);
}
for (const [c, reason] of Object.entries(EXCLUDED_AUTH_FIELDS)) {
  check(`exclusion for ${c} documents a reason`, typeof reason === "string" && reason.length > 8);
  check(`excluded column ${c} is not in the snapshot by accident`, schema["auth.users"].includes(c), "stale exclusion");
}

console.log("4. Secrets never appear (columns or values)");
for (const bad of ["encrypted_password", "confirmation_token", "recovery_token", "email_change_token_new", "email_change_token_current", "phone_change_token", "reauthentication_token"]) {
  check(`no ${bad} key`, !keys.some((k) => k.endsWith(bad)));
  check(`no ${bad} value`, !values.includes(`v:${bad}`));
}
check("no secret-looking key at all", !keys.some((k) => SECRET_NAME.test(k)), keys.filter((k) => SECRET_NAME.test(k)).join());
check("token-named user metadata dropped", !keys.some((k) => /access_token/.test(k)) && !values.includes("SECRET"));
check("nested metadata objects are not flattened blindly", !keys.some((k) => k.includes("nested")));
check("raw app metadata not exported", !keys.some((k) => k.includes("app_meta")));
check("no raw IP style columns", !keys.some((k) => /(^|_)ip($|_)|ip_hash|ip_addr/.test(k)));

console.log("5. User metadata is exported key by key");
check("full_name/avatar/locale/timezone", ["account_meta_full_name", "account_meta_avatar_url", "account_meta_locale", "account_meta_timezone"].every((k) => keys.includes(k)));

console.log("6. A profile column added in the future is exported automatically; a secret one is not");
{
  const future = buildAdminProfile({
    adminRow: { ...adminRow, first_name: "Ada", last_name: "Admin", phone: "+000", timezone: "UTC", locale: "en", company: "Org", notification_settings: "on", avatar_url: "x", api_key: "K", password_hash: "H", refresh_token: "T" },
    userProfileRow,
    authUser,
  });
  for (const c of ["first_name", "last_name", "phone", "timezone", "locale", "company", "notification_settings", "avatar_url"]) {
    check(`new admin_users.${c} exported without code changes`, `admin_${c}` in future);
  }
  for (const c of ["api_key", "password_hash", "refresh_token"]) check(`new secret-named ${c} not exported`, !(`admin_${c}` in future));
}

console.log("7. Null/empty stays empty; ordering is deterministic");
{
  const sparse = buildAdminProfile({ adminRow: { user_id: "u", role: "admin", display_name: null, is_active: true, created_at: "c", updated_at: "u" }, authUser: { id: "u", email: "e@x.test", phone: null } });
  check("null display_name kept as null", sparse.admin_display_name === null);
  check("null phone kept as null", sparse.account_phone === null);
  const again = buildAdminProfile({ adminRow: { updated_at: "u", is_active: true, role: "admin", user_id: "u", created_at: "c", display_name: null }, authUser: { phone: null, email: "e@x.test", id: "u" } });
  check("column order does not depend on row key order", Object.keys(sparse).join() === Object.keys(again).join());
  check("known columns first, in canonical order", Object.keys(sparse).slice(0, 6).join() === "admin_user_id,admin_role,admin_display_name,admin_is_active,admin_created_at,admin_updated_at");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

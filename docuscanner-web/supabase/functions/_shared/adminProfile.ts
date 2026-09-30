// Admin Profile export model. The exported profile is DERIVED from the rows
// themselves, not from a hand-kept list of columns: every column of
// public.admin_users, every column of public.user_profiles (the admin's own
// profile row) and every non-secret column of their auth account is emitted
// automatically, so a column added to any of them later is exported without
// touching this file. What is NOT exported is decided by the explicit,
// documented exclusions below, plus a secret-name denylist that also
// protects columns added in the future.
//
// Column naming: admin_<col> (public.admin_users), profile_<col>
// (public.user_profiles), account_<col> (auth account, including flattened
// top-level user metadata as account_meta_<key>). Ordering is deterministic:
// known columns in the order listed here, then any others alphabetically.

export type Cell = string | number | boolean | null;
export type AdminProfileRecord = Record<string, Cell>;

// Auth account columns that are never exported, each with the reason.
export const EXCLUDED_AUTH_FIELDS: Record<string, string> = {
  encrypted_password: "password hash",
  confirmation_token: "single-use authentication token",
  recovery_token: "single-use authentication token",
  email_change_token_new: "single-use authentication token",
  email_change_token_current: "single-use authentication token",
  phone_change_token: "single-use authentication token",
  reauthentication_token: "single-use authentication token",
  confirmation_sent_at: "internal auth workflow state, no profile meaning",
  recovery_sent_at: "internal auth workflow state, no profile meaning",
  email_change_sent_at: "internal auth workflow state, no profile meaning",
  phone_change_sent_at: "internal auth workflow state, no profile meaning",
  reauthentication_sent_at: "internal auth workflow state, no profile meaning",
  email_change_confirm_status: "internal auth workflow state, no profile meaning",
  email_change: "pending unverified address change (auth workflow state)",
  phone_change: "pending unverified number change (auth workflow state)",
  instance_id: "infrastructure identifier",
  aud: "JWT audience claim, infrastructure",
  role: "Postgres/JWT role ('authenticated'), not the admin role -- admin_role is the source of truth",
  is_super_admin: "legacy GoTrue flag; privileges come from admin_users.role",
  confirmed_at: "generated duplicate of email_confirmed_at",
  deleted_at: "soft-delete marker; deleted accounts cannot authenticate",
  raw_app_meta_data: "provider/auth internals (may hold provider details); only user-facing metadata is exported",
  raw_user_meta_data: "exported flattened, key by key (account_meta_*), through the secret-name filter",
};

// Any column/metadata key whose NAME looks like a secret is excluded, so a
// future credential-like column can never leak through the derived export.
export const SECRET_NAME = /pass(word|wd)?|secret|token|hash|salt|credential|api[_-]?key|private|otp|\bkey\b|_key$|^key_|refresh|session|ip_?addr|^ip$|_ip$|ip_hash/i;

const ADMIN_ORDER = ["user_id", "role", "display_name", "is_active", "created_at", "updated_at"];
const PROFILE_ORDER = ["user_id", "display_name", "country_code", "created_at", "updated_at"];
const ACCOUNT_ORDER = [
  "id", "email", "email_confirmed_at", "phone", "phone_confirmed_at", "last_sign_in_at",
  "created_at", "updated_at", "banned_until", "is_sso_user", "is_anonymous", "invited_at",
];

function toCell(value: unknown): Cell | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) return value.join(";");
  return undefined; // nested objects are never flattened blindly
}

function ordered(keys: string[], known: string[]): string[] {
  const rest = keys.filter((k) => !known.includes(k)).sort();
  return [...known.filter((k) => keys.includes(k)), ...rest];
}

function take(prefix: string, row: Record<string, unknown> | null | undefined, known: string[], out: AdminProfileRecord, skip: (key: string) => boolean = () => false) {
  if (!row) return;
  for (const key of ordered(Object.keys(row), known)) {
    if (skip(key) || SECRET_NAME.test(key)) continue;
    const cell = toCell(row[key]);
    if (cell !== undefined) out[`${prefix}${key}`] = cell;
  }
}

export interface AdminProfileSources {
  adminRow: Record<string, unknown> | null;
  userProfileRow?: Record<string, unknown> | null;
  // The auth account (GoTrue admin API user object or auth.users row).
  authUser?: Record<string, unknown> | null;
}

export function buildAdminProfile({ adminRow, userProfileRow, authUser }: AdminProfileSources): AdminProfileRecord {
  const out: AdminProfileRecord = {};
  take("admin_", adminRow, ADMIN_ORDER, out);
  take("profile_", userProfileRow, PROFILE_ORDER, out, (k) => k === "user_id");
  take("account_", authUser, ACCOUNT_ORDER, out, (k) => k in EXCLUDED_AUTH_FIELDS || k === "user_metadata" || k === "app_metadata" || k === "identities" || k === "factors");
  // GoTrue's admin API names the metadata objects user_metadata /
  // raw_user_meta_data; both spellings are read.
  const meta = (authUser?.user_metadata ?? authUser?.raw_user_meta_data) as Record<string, unknown> | undefined;
  if (meta && typeof meta === "object") {
    for (const key of Object.keys(meta).sort()) {
      if (SECRET_NAME.test(key)) continue;
      const cell = toCell(meta[key]);
      if (cell !== undefined) out[`account_meta_${key}`] = cell;
    }
  }
  return out;
}

// Deterministic column order for a profile record: the order buildAdminProfile
// produced (admin_, profile_, account_, account_meta_ groups).
export function profileColumns(profile: AdminProfileRecord): string[] {
  return Object.keys(profile);
}

const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const env = require("../config/env");
const tokenService = require("./tokenService");
const otpService = require("./otpService");
const oauthService = require("./oauthService");

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    subscriptionPlan: row.role || row.plan || "free",
    role: row.role || "free",
    conversionsUsed: row.conversions_used ?? row.conversions_today ?? 0,
    emailVerified: row.email_verified ?? false,
    authProvider: row.auth_provider || "email",
    biometricEnabled: row.biometric_enabled ?? false,
    createdAt: row.created_at,
  };
}

async function issueAuthResponse(userRow) {
  const user = sanitizeUser(userRow);
  const accessToken = tokenService.signAccessToken(userRow);
  const refreshToken = tokenService.signRefreshToken(userRow);
  await tokenService.storeRefreshToken(userRow.id, refreshToken);

  return {
    accessToken,
    refreshToken,
    user,
  };
}

async function register({ fullName, email, password }) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existing.rows.length) {
    const error = new Error("Email already registered.");
    error.status = 409;
    throw error;
  }

  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, email_verified)
     VALUES ($1, $2, $3, $4, 'free', FALSE)`,
    [id, fullName?.trim() || "", normalizedEmail, passwordHash]
  );

  const otp = await otpService.createAndSendOtp({
    userId: id,
    email: normalizedEmail,
    purpose: "email_verify",
  });

  const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  const tokens = await issueAuthResponse(userResult.rows[0]);

  return { ...tokens, requiresEmailVerification: true, otp };
}

async function login(email, password) {
  const normalizedEmail = email.toLowerCase().trim();
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
  const user = result.rows[0];

  if (!user) {
    const error = new Error("Invalid credentials.");
    error.status = 401;
    throw error;
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const error = new Error("Account temporarily locked. Try again later.");
    error.status = 423;
    throw error;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const attempts = (user.failed_login_attempts || 0) + 1;
    let lockedUntil = null;

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
    }

    await pool.query(
      `UPDATE users SET failed_login_attempts = $2, locked_until = $3 WHERE id = $1`,
      [user.id, attempts, lockedUntil]
    );

    const error = new Error(
      attempts >= MAX_FAILED_ATTEMPTS
        ? "Too many failed attempts. Account locked for 15 minutes."
        : "Invalid credentials."
    );
    error.status = attempts >= MAX_FAILED_ATTEMPTS ? 423 : 401;
    throw error;
  }

  await pool.query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [user.id]
  );

  return issueAuthResponse(user);
}

async function refresh(refreshToken) {
  const row = await tokenService.verifyRefreshToken(refreshToken);
  await tokenService.revokeRefreshToken(refreshToken);
  return issueAuthResponse(row);
}

async function logout(refreshToken) {
  if (refreshToken) await tokenService.revokeRefreshToken(refreshToken);
}

async function logoutAll(userId) {
  await tokenService.revokeAllUserTokens(userId);
}

async function verifyEmail(email, code) {
  await otpService.verifyOtp({ email, code, purpose: "email_verify" });
  await pool.query(
    `UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE email = $1`,
    [email.toLowerCase()]
  );
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
  return sanitizeUser(result.rows[0]);
}

async function requestPasswordReset(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const result = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);

  if (!result.rows.length) {
    return { message: "If the email exists, a reset code was sent." };
  }

  const otp = await otpService.createAndSendOtp({
    userId: result.rows[0].id,
    email: normalizedEmail,
    purpose: "password_reset",
  });

  return { message: "If the email exists, a reset code was sent.", otp };
}

async function resetPassword(email, code, newPassword) {
  await otpService.verifyOtp({ email, code, purpose: "password_reset" });
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const normalizedEmail = email.toLowerCase().trim();

  const result = await pool.query(
    `UPDATE users SET password_hash = $2, failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
     WHERE email = $1 RETURNING *`,
    [normalizedEmail, passwordHash]
  );

  await tokenService.revokeAllUserTokens(result.rows[0].id);
  return sanitizeUser(result.rows[0]);
}

async function resendOtp(email, purpose) {
  const normalizedEmail = email.toLowerCase().trim();
  const result = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (!result.rows.length && purpose !== "email_verify") {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  return otpService.createAndSendOtp({
    userId: result.rows[0]?.id,
    email: normalizedEmail,
    purpose,
  });
}

async function getUserById(id) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return sanitizeUser(result.rows[0]);
}

async function updateProfile(userId, { fullName }) {
  const result = await pool.query(
    `UPDATE users SET full_name = COALESCE($2, full_name), updated_at = NOW() WHERE id = $1 RETURNING *`,
    [userId, fullName]
  );
  return sanitizeUser(result.rows[0]);
}

async function setBiometricEnabled(userId, enabled) {
  const result = await pool.query(
    `UPDATE users SET biometric_enabled = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [userId, !!enabled]
  );
  return sanitizeUser(result.rows[0]);
}

async function findUserByProvider(provider, providerId) {
  const column = provider === "google" ? "google_id" : "apple_id";
  const result = await pool.query(`SELECT * FROM users WHERE ${column} = $1`, [providerId]);
  return result.rows[0];
}

async function socialLogin(providerPayload) {
  const { provider, providerId, email, fullName, emailVerified } = providerPayload;
  let user = await findUserByProvider(provider, providerId);

  if (!user && email) {
    const byEmail = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    user = byEmail.rows[0];
    if (user) {
      const col = provider === "google" ? "google_id" : "apple_id";
      await pool.query(
        `UPDATE users SET ${col} = $2, auth_provider = $3, email_verified = TRUE, updated_at = NOW() WHERE id = $1`,
        [user.id, providerId, provider]
      );
      const refreshed = await pool.query("SELECT * FROM users WHERE id = $1", [user.id]);
      user = refreshed.rows[0];
    }
  }

  if (!user) {
    const id = uuidv4();
    const randomPass = await bcrypt.hash(uuidv4(), 12);
    const col = provider === "google" ? "google_id" : "apple_id";
    const resolvedEmail = email || `${providerId}@${provider}.local`;

    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, role, email_verified, auth_provider, ${col})
       VALUES ($1, $2, $3, $4, 'free', $5, $6, $7)`,
      [id, fullName || "", resolvedEmail, randomPass, emailVerified || !!email, provider, providerId]
    );

    const created = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    user = created.rows[0];
  } else if (fullName && !user.full_name) {
    await pool.query(`UPDATE users SET full_name = $2, updated_at = NOW() WHERE id = $1`, [user.id, fullName]);
    const refreshed = await pool.query("SELECT * FROM users WHERE id = $1", [user.id]);
    user = refreshed.rows[0];
  }

  return issueAuthResponse(user);
}

async function loginWithGoogle(idToken) {
  const profile = await oauthService.verifyGoogleIdToken(idToken);
  return socialLogin(profile);
}

async function loginWithApple(identityToken, fullName) {
  const profile = await oauthService.verifyAppleIdentityToken(identityToken, fullName);
  return socialLogin(profile);
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  resendOtp,
  getUserById,
  updateProfile,
  setBiometricEnabled,
  loginWithGoogle,
  loginWithApple,
  sanitizeUser,
};

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const env = require("../config/env");

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      subscriptionPlan: user.subscription_plan || user.role,
    },
    env.jwtSecret,
    { expiresIn: env.jwtAccessExpiresIn }
  );
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: "refresh" }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });
}

async function storeRefreshToken(userId, refreshToken) {
  const id = uuidv4();
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + parseDurationMs(env.jwtRefreshExpiresIn));

  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [id, userId, tokenHash, expiresAt]
  );

  return id;
}

async function verifyRefreshToken(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.jwtRefreshSecret);
  } catch {
    const error = new Error("Invalid refresh token.");
    error.status = 401;
    throw error;
  }

  const result = await pool.query(
    `SELECT rt.*, u.id, u.email, u.full_name, u.role, u.email_verified, u.conversions_used, u.created_at
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.user_id = $1 AND rt.revoked = FALSE AND rt.expires_at > NOW()
     ORDER BY rt.created_at DESC LIMIT 20`,
    [payload.sub]
  );

  for (const row of result.rows) {
    const match = await bcrypt.compare(refreshToken, row.token_hash);
    if (match) return row;
  }

  const error = new Error("Refresh token revoked or expired.");
  error.status = 401;
  throw error;
}

async function revokeRefreshToken(refreshToken) {
  const rows = await pool.query(
    `SELECT id, token_hash FROM refresh_tokens WHERE revoked = FALSE AND expires_at > NOW()`
  );

  for (const row of rows.rows) {
    const match = await bcrypt.compare(refreshToken, row.token_hash);
    if (match) {
      await pool.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1`, [row.id]);
    }
  }
}

async function revokeAllUserTokens(userId) {
  await pool.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`, [userId]);
}

function parseDurationMs(duration) {
  const match = String(duration).match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * multipliers[unit];
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  storeRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  generateOtpCode,
  hashToken,
};

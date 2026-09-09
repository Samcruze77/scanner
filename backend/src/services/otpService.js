const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const tokenService = require("./tokenService");
const emailService = require("./emailService");

const OTP_TTL_MINUTES = 10;

async function createAndSendOtp({ userId, email, purpose }) {
  const code = tokenService.generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await pool.query(
    `UPDATE otp_verifications SET used = TRUE
     WHERE email = $1 AND purpose = $2 AND used = FALSE`,
    [email.toLowerCase(), purpose]
  );

  await pool.query(
    `INSERT INTO otp_verifications (id, user_id, email, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [uuidv4(), userId || null, email.toLowerCase(), codeHash, purpose, expiresAt]
  );

  if (purpose === "email_verify") {
    await emailService.sendVerificationEmail(email, code);
  } else if (purpose === "password_reset") {
    await emailService.sendPasswordResetEmail(email, code);
  }

  return { expiresAt, devCode: process.env.NODE_ENV !== "production" ? code : undefined };
}

async function verifyOtp({ email, code, purpose }) {
  const result = await pool.query(
    `SELECT * FROM otp_verifications
     WHERE email = $1 AND purpose = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email.toLowerCase(), purpose]
  );

  const row = result.rows[0];
  if (!row) {
    const error = new Error("Invalid or expired OTP.");
    error.status = 400;
    throw error;
  }

  const valid = await bcrypt.compare(code, row.code_hash);
  if (!valid) {
    const error = new Error("Invalid or expired OTP.");
    error.status = 400;
    throw error;
  }

  await pool.query(`UPDATE otp_verifications SET used = TRUE WHERE id = $1`, [row.id]);
  return row;
}

module.exports = { createAndSendOtp, verifyOtp };

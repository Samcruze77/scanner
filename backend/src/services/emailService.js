const env = require("../config/env");

/**
 * Email delivery adapter.
 * In production, integrate SendGrid, AWS SES, or Resend.
 */
async function sendEmail({ to, subject, html, text }) {
  if (env.nodeEnv !== "production") {
    console.log("[email:dev]", { to, subject, text: text || html });
    return { success: true, dev: true };
  }

  if (!env.smtp?.host) {
    console.warn("[email] SMTP not configured. Email not sent.");
    return { success: false };
  }

  // Placeholder for production SMTP integration
  console.log("[email] Would send to", to, subject);
  return { success: true };
}

async function sendVerificationEmail(email, code) {
  return sendEmail({
    to: email,
    subject: "Verify your email - Document Scanner",
    text: `Your verification code is: ${code}. It expires in 10 minutes.`,
    html: `<p>Your verification code is <strong>${code}</strong>.</p>`,
  });
}

async function sendPasswordResetEmail(email, code) {
  return sendEmail({
    to: email,
    subject: "Reset your password - Document Scanner",
    text: `Your password reset code is: ${code}. It expires in 15 minutes.`,
    html: `<p>Your password reset code is <strong>${code}</strong>.</p>`,
  });
}

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail };

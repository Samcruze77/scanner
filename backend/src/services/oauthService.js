const { OAuth2Client } = require("google-auth-library");
const appleSignin = require("apple-signin-auth");
const env = require("../config/env");

async function verifyGoogleIdToken(idToken) {
  if (!idToken) {
    const error = new Error("Google ID token is required.");
    error.status = 400;
    throw error;
  }

  const audiences = [
    env.google.clientId,
    env.google.iosClientId,
    env.google.androidClientId,
  ].filter(Boolean);

  if (!audiences.length) {
    const error = new Error("Google OAuth is not configured on the server.");
    error.status = 503;
    throw error;
  }

  const client = new OAuth2Client(env.google.clientId || audiences[0]);
  const ticket = await client.verifyIdToken({ idToken, audience: audiences });
  const payload = ticket.getPayload();

  return {
    provider: "google",
    providerId: payload.sub,
    email: payload.email?.toLowerCase(),
    fullName: payload.name || payload.given_name || "",
    emailVerified: payload.email_verified === true,
  };
}

async function verifyAppleIdentityToken(identityToken, fullName) {
  if (!identityToken) {
    const error = new Error("Apple identity token is required.");
    error.status = 400;
    throw error;
  }

  const payload = await appleSignin.verifyIdToken(identityToken, {
    audience: env.apple.clientId,
    ignoreExpiration: false,
  });

  return {
    provider: "apple",
    providerId: payload.sub,
    email: payload.email?.toLowerCase(),
    fullName: fullName || "",
    emailVerified: !!payload.email,
  };
}

module.exports = { verifyGoogleIdToken, verifyAppleIdentityToken };

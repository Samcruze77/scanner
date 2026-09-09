const { pool } = require("../config/database");

async function savePushToken({ userId, token, platform }) {
  if (!userId || !token) return;
  await pool.query(
    `INSERT INTO push_tokens (user_id, token, platform, enabled, updated_at)
     VALUES ($1, $2, $3, TRUE, NOW())
     ON CONFLICT (token)
     DO UPDATE SET user_id = EXCLUDED.user_id,
                   platform = EXCLUDED.platform,
                   enabled = TRUE,
                   updated_at = NOW()`,
    [userId, token, platform || null]
  );
}

async function updateNotificationSettings({ userId, enabled }) {
  await pool.query(`UPDATE push_tokens SET enabled = $2, updated_at = NOW() WHERE user_id = $1`, [
    userId,
    Boolean(enabled),
  ]);
}

async function getEnabledTokens(userId) {
  if (!userId) return [];
  const result = await pool.query(
    `SELECT token FROM push_tokens WHERE user_id = $1 AND enabled = TRUE`,
    [userId]
  );
  return result.rows.map((row) => row.token);
}

async function sendExpoPush(tokens, notification) {
  if (!tokens.length || typeof fetch !== "function") return;

  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: notification.title,
    body: notification.body,
    data: notification.data || {},
  }));

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  }).catch((error) => {
    console.warn("Expo push notification failed:", error.message);
  });
}

async function notifyJobUpdate({ userId, jobId, type, title, body, result }) {
  const tokens = await getEnabledTokens(userId);
  await sendExpoPush(tokens, {
    title,
    body,
    data: {
      type,
      jobId,
      result,
      deepLink: `documentscanner://conversion-result/${jobId}`,
    },
  });
}

module.exports = {
  savePushToken,
  updateNotificationSettings,
  notifyJobUpdate,
};

const { pool } = require("../config/database");

async function track(eventType, { userId, conversionType, metadata = {} }) {
  await pool.query(
    `INSERT INTO analytics_events (user_id, event_type, conversion_type, metadata)
     VALUES ($1, $2, $3, $4)`,
    [userId || null, eventType, conversionType || null, JSON.stringify(metadata)]
  );
}

async function getDashboardStats() {
  const [total, failed, byType, activeUsers] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM analytics_events WHERE event_type = 'conversion_success'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM analytics_events WHERE event_type = 'conversion_failed'`),
    pool.query(
      `SELECT conversion_type, COUNT(*)::int AS count
       FROM analytics_events WHERE event_type = 'conversion_success' AND conversion_type IS NOT NULL
       GROUP BY conversion_type ORDER BY count DESC LIMIT 10`
    ),
    pool.query(
      `SELECT COUNT(DISTINCT user_id)::int AS count FROM analytics_events
       WHERE user_id IS NOT NULL AND created_at > NOW() - INTERVAL '7 days'`
    ),
  ]);

  return {
    totalConversions: total.rows[0]?.count || 0,
    failedConversions: failed.rows[0]?.count || 0,
    mostUsedTypes: byType.rows,
    activeUsers7d: activeUsers.rows[0]?.count || 0,
  };
}

module.exports = { track, getDashboardStats };

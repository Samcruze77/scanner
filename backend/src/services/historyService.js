const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");

async function createHistoryEntry({
  userId,
  jobId,
  originalFilename,
  conversionType,
  fileSizeBytes,
}) {
  const id = uuidv4();
  await pool.query(
    `INSERT INTO conversion_history
      (id, user_id, job_id, original_filename, conversion_type, file_size_bytes, status, progress_percentage)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', 0)`,
    [id, userId || null, jobId, originalFilename, conversionType, fileSizeBytes || 0]
  );
  return id;
}

async function markHistorySuccess(historyId, { convertedFilename, downloadUrl, storageKey }) {
  await pool.query(
    `UPDATE conversion_history
     SET status = 'completed', converted_filename = $2, download_url = $3,
         storage_key = $4, progress_percentage = 100, completed_at = NOW()
     WHERE id = $1`,
    [historyId, convertedFilename, downloadUrl, storageKey]
  );
}

async function markHistoryFailed(historyId, errorMessage) {
  await pool.query(
    `UPDATE conversion_history
        SET status = 'failed',
            progress_percentage = 100,
            error_message = $2,
            completed_at = NOW()
      WHERE id = $1`,
    [historyId, errorMessage]
  );
}

async function listHistory(userId, limit = 50) {
  const result = await pool.query(
    `SELECT * FROM conversion_history
     WHERE user_id = $1 OR ($1 IS NULL AND user_id IS NULL)
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

async function getHistoryById(id, userId) {
  const result = await pool.query(
    `SELECT * FROM conversion_history WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)`,
    [id, userId]
  );
  return result.rows[0];
}

async function deleteHistory(id, userId) {
  await pool.query(`DELETE FROM conversion_history WHERE id = $1 AND user_id = $2`, [id, userId]);
}

module.exports = {
  createHistoryEntry,
  markHistorySuccess,
  markHistoryFailed,
  listHistory,
  getHistoryById,
  deleteHistory,
};

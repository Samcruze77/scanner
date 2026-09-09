const { pool } = require("../config/database");

async function createJobRecord({ jobId, historyId, userId, conversionType, files = [] }) {
  await pool.query(
    `INSERT INTO conversion_jobs (job_id, history_id, user_id, conversion_type, status, progress_percentage)
     VALUES ($1, $2, $3, $4, 'queued', 0)
     ON CONFLICT (job_id) DO UPDATE
       SET history_id = EXCLUDED.history_id,
           user_id = EXCLUDED.user_id,
           conversion_type = EXCLUDED.conversion_type`,
    [String(jobId), historyId || null, userId || null, conversionType]
  );

  for (const file of files) {
    await pool.query(
      `INSERT INTO file_metadata
        (job_id, user_id, original_filename, stored_path, mime_type, size_bytes, role)
       VALUES ($1, $2, $3, $4, $5, $6, 'input')`,
      [
        String(jobId),
        userId || null,
        file.originalname,
        file.path,
        file.mimetype,
        file.size || 0,
      ]
    );
  }
}

module.exports = {
  createJobRecord,
};

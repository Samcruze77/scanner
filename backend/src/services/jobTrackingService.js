const { pool } = require("../config/database");

const FINAL_STATES = new Set(["completed", "failed"]);

function normalizeProgress(progress) {
  if (typeof progress === "number") return Math.max(0, Math.min(100, Math.round(progress)));
  const parsed = Number(progress);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

async function updateJobTracking(jobId, patch = {}) {
  if (!jobId) return null;

  const current = await pool.query(
    `SELECT id, user_id, job_id, conversion_type, status, progress_percentage,
            retry_count, created_at, started_at, completed_at, processing_time_ms
       FROM conversion_history
      WHERE job_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [String(jobId)]
  );

  const row = current.rows[0];
  if (!row) return null;

  const status = patch.status || row.status;
  const progress = patch.progress != null ? normalizeProgress(patch.progress) : row.progress_percentage || 0;
  const retryCount = patch.retryCount != null ? Number(patch.retryCount) : row.retry_count || 0;
  const errorMessage = patch.errorMessage || null;
  const isFinal = FINAL_STATES.has(status);

  const updated = await pool.query(
    `UPDATE conversion_history
        SET status = $2,
            progress_percentage = $3,
            retry_count = $4,
            started_at = CASE
              WHEN $2 = 'processing' AND started_at IS NULL THEN NOW()
              ELSE started_at
            END,
            completed_at = CASE
              WHEN $5 = TRUE THEN COALESCE(completed_at, NOW())
              ELSE completed_at
            END,
            processing_time_ms = CASE
              WHEN $5 = TRUE THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - COALESCE(started_at, created_at))) * 1000))::INT
              ELSE processing_time_ms
            END,
            error_message = CASE
              WHEN $6::TEXT IS NOT NULL THEN $6
              WHEN $2 != 'failed' THEN NULL
              ELSE error_message
            END
      WHERE job_id = $1
      RETURNING id, user_id, job_id, conversion_type, status, progress_percentage,
                retry_count, started_at, completed_at, processing_time_ms, error_message`,
    [String(jobId), status, progress, retryCount, isFinal, errorMessage]
  );

  await pool.query(
    `UPDATE conversion_jobs
        SET status = $2,
            progress_percentage = $3,
            retry_count = $4,
            started_at = CASE
              WHEN $2 = 'processing' AND started_at IS NULL THEN NOW()
              ELSE started_at
            END,
            completed_at = CASE
              WHEN $5 = TRUE THEN COALESCE(completed_at, NOW())
              ELSE completed_at
            END,
            processing_time_ms = CASE
              WHEN $5 = TRUE THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - COALESCE(started_at, queued_at))) * 1000))::INT
              ELSE processing_time_ms
            END,
            error_message = CASE
              WHEN $6::TEXT IS NOT NULL THEN $6
              WHEN $2 != 'failed' THEN NULL
              ELSE error_message
            END,
            result = CASE
              WHEN $7::JSONB IS NOT NULL THEN $7
              ELSE result
            END
      WHERE job_id = $1`,
    [String(jobId), status, progress, retryCount, isFinal, errorMessage, patch.result ? JSON.stringify(patch.result) : null]
  );

  return updated.rows[0];
}

async function getJobTracking(jobId) {
  const result = await pool.query(
    `SELECT id, user_id, job_id, conversion_type, status, progress_percentage,
            retry_count, started_at, completed_at, processing_time_ms, error_message
       FROM conversion_history
      WHERE job_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [String(jobId)]
  );
  return result.rows[0] || null;
}

module.exports = {
  updateJobTracking,
  getJobTracking,
};

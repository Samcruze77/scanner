CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  plan VARCHAR(32) NOT NULL DEFAULT 'free',
  stripe_customer_id VARCHAR(255),
  conversions_today INT NOT NULL DEFAULT 0,
  conversions_reset_at DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversion_history (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  job_id VARCHAR(64),
  original_filename VARCHAR(512) NOT NULL,
  converted_filename VARCHAR(512),
  conversion_type VARCHAR(64) NOT NULL,
  file_size_bytes BIGINT DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  progress_percentage INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  processing_time_ms INT,
  retry_count INT NOT NULL DEFAULT 0,
  download_url TEXT,
  storage_key TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversion_jobs (
  job_id VARCHAR(64) PRIMARY KEY,
  history_id VARCHAR(36) REFERENCES conversion_history(id) ON DELETE SET NULL,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  conversion_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  progress_percentage INT NOT NULL DEFAULT 0,
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT,
  result JSONB DEFAULT '{}',
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  processing_time_ms INT
);

CREATE TABLE IF NOT EXISTS file_metadata (
  id SERIAL PRIMARY KEY,
  job_id VARCHAR(64) REFERENCES conversion_jobs(job_id) ON DELETE CASCADE,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  original_filename VARCHAR(512) NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type VARCHAR(255),
  size_bytes BIGINT DEFAULT 0,
  role VARCHAR(32) NOT NULL DEFAULT 'input',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE conversion_history ADD COLUMN IF NOT EXISTS progress_percentage INT NOT NULL DEFAULT 0;
ALTER TABLE conversion_history ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE conversion_history ADD COLUMN IF NOT EXISTS processing_time_ms INT;
ALTER TABLE conversion_history ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS push_tokens (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  platform VARCHAR(32),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(64) NOT NULL,
  conversion_type VARCHAR(64),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS signatures (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
  signature_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT,
  file_size BIGINT,
  file_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_pages (
  id VARCHAR(36) PRIMARY KEY,
  document_id VARCHAR(36) REFERENCES documents(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exports (
  id VARCHAR(36) PRIMARY KEY,
  document_id VARCHAR(36) REFERENCES documents(id) ON DELETE CASCADE,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
  export_url TEXT,
  format VARCHAR(10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_user_created ON conversion_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_job ON conversion_history(job_id);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_user ON conversion_jobs(user_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_status ON conversion_jobs(status, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_metadata_job ON file_metadata(job_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event_created ON analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_signatures_user_created ON signatures(user_id, created_at DESC);

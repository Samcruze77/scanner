const fs = require("fs");
const path = require("path");
const env = require("../config/env");
const { initStorageDirs } = require("../utils/fileUtils");
const { pool } = require("../config/database");
const storageService = require("./storageService");

const TTL_MS = env.fileTtlHours * 60 * 60 * 1000;

async function purgeOldFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return;

  const now = Date.now();
  const entries = await fs.promises.readdir(dirPath);

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry);
      const stat = await fs.promises.stat(fullPath);
      if (stat.isDirectory()) {
        await purgeOldFiles(fullPath);
        const remaining = await fs.promises.readdir(fullPath).catch(() => []);
        if (!remaining.length) await fs.promises.rmdir(fullPath).catch(() => {});
        return;
      }
      if (now - stat.mtimeMs > TTL_MS) {
        await fs.promises.unlink(fullPath).catch(() => {});
      }
    })
  );
}

async function purgeExpiredHistoryStorage() {
  const result = await pool.query(
    `SELECT id, storage_key FROM conversion_history
     WHERE storage_key IS NOT NULL
       AND completed_at < NOW() - ($1::text || ' hours')::interval
     LIMIT 100`,
    [String(env.fileTtlHours)]
  );

  for (const row of result.rows) {
    await storageService.deleteStoredFile(row.storage_key).catch(() => {});
  }
}

function startCleanupScheduler() {
  initStorageDirs();
  const run = () => {
    purgeOldFiles(env.uploadDir);
    purgeOldFiles(env.outputDir);
    purgeExpiredHistoryStorage().catch(() => {});
  };

  run();
  setInterval(run, 60 * 60 * 1000);
}

module.exports = { purgeOldFiles, startCleanupScheduler };

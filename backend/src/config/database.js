const { Pool } = require("pg");
const env = require("./env");
const logger = require("./logger");

let pool;

if (env.useMemoryDb) {
  const { newDb } = require("pg-mem");
  const mem = newDb();
  const fs = require("fs");
  const path = require("path");
  const schemaDir = path.join(__dirname, "..", "db");

  for (const file of ["schema.sql", "auth-schema.sql", "oauth-schema.sql"]) {
    let sql = fs.readFileSync(path.join(schemaDir, file), "utf8");
    sql = sql.replace(/DO\s+\$\$[\s\S]*?\$\$;/g, "");
    mem.public.none(sql);
  }

  const adapter = mem.adapters.createPg();
  pool = new adapter.Pool();
  logger.info("Using in-memory database (USE_MEMORY_DB=true). Data resets when the server restarts.");
} else {
  pool = new Pool({
    connectionString: env.databaseUrl,
    ssl: env.nodeEnv === "production" ? { rejectUnauthorized: false } : false,
  });
}

pool.on("error", (err) => {
  logger.error("Unexpected DB error", { error: err });
});

module.exports = { pool };

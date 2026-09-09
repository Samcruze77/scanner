const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const authSchemaPath = path.join(__dirname, "auth-schema.sql");
  const oauthSchemaPath = path.join(__dirname, "oauth-schema.sql");
  await pool.query(fs.readFileSync(schemaPath, "utf8"));
  await pool.query(fs.readFileSync(authSchemaPath, "utf8"));
  await pool.query(fs.readFileSync(oauthSchemaPath, "utf8"));
  console.log("Database migration completed.");
  await pool.end();
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});

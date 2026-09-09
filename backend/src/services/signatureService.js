const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");

async function saveSignature({ userId, signature }) {
  if (!signature) {
    throw new Error("Signature is required.");
  }

  const id = uuidv4();
  const result = await pool.query(
    `INSERT INTO signatures (id, user_id, signature_url, created_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, user_id, signature_url, created_at`,
    [id, userId || null, signature]
  );

  return result.rows[0];
}

module.exports = { saveSignature };

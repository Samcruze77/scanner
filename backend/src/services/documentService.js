const { v4: uuidv4 } = require("uuid");
const { pool } = require("../config/database");
const pdfService = require("./pdfService");

async function createDocument({ userId, filename, fileSize, fileUrl }) {
  const id = uuidv4();
  const result = await pool.query(
    `INSERT INTO documents (id, user_id, filename, file_size, file_url, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [id, userId, filename, fileSize, fileUrl]
  );
  return result.rows[0];
}

async function getDocumentById(id) {
  const result = await pool.query("SELECT * FROM documents WHERE id = $1", [id]);
  return result.rows[0];
}

async function compressDocument(id) {
  const doc = await getDocumentById(id);
  if (!doc) throw new Error("Document not found");
  
  // Implementation would typically involve downloading the file, 
  // compressing it using pdfService, uploading new version, and updating DB.
  // For now, we'll simulate or call pdfService if we have a local path.
  return doc; 
}

async function signDocument(id, signature, options) {
  const doc = await getDocumentById(id);
  if (!doc) throw new Error("Document not found");
  
  // Similar to compress, would use pdfService.signPdf
  return doc;
}

async function exportDocument(id, format) {
  const doc = await getDocumentById(id);
  if (!doc) throw new Error("Document not found");
  
  const exportId = uuidv4();
  const exportUrl = doc.file_url; // In reality, would be a new URL
  const result = await pool.query(
    `INSERT INTO exports (id, document_id, user_id, export_url, format, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [exportId, id, doc.user_id, exportUrl, format]
  );
  return result.rows[0];
}

module.exports = {
  createDocument,
  getDocumentById,
  compressDocument,
  signDocument,
  exportDocument,
};

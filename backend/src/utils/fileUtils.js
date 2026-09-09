const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const env = require("../config/env");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeFilename(name) {
  return path.basename(String(name || "file")).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function buildOutputPath(extension) {
  ensureDir(env.outputDir);
  const fileName = `${uuidv4()}.${extension.replace(/^\./, "")}`;
  return path.join(env.outputDir, fileName);
}

function buildPublicUrl(fileName) {
  return `${env.apiBaseUrl}/files/${fileName}`;
}

function getFileNameFromPath(filePath) {
  return path.basename(filePath);
}

async function removeFile(filePath) {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (_) {
    /* ignore missing */
  }
}

async function removeFiles(filePaths = []) {
  await Promise.all(filePaths.map((p) => removeFile(p)));
}

function initStorageDirs() {
  ensureDir(env.uploadDir);
  ensureDir(env.outputDir);
}

module.exports = {
  ensureDir,
  sanitizeFilename,
  buildOutputPath,
  buildPublicUrl,
  getFileNameFromPath,
  removeFile,
  removeFiles,
  initStorageDirs,
};

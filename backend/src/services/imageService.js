const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const env = require("../config/env");
const { ensureDir } = require("../utils/fileUtils");

async function normalizeImages(inputPaths) {
  ensureDir(env.uploadDir);
  const normalized = [];

  for (const inputPath of inputPaths) {
    const outPath = path.join(env.uploadDir, `norm_${path.basename(inputPath)}.jpg`);
    await sharp(inputPath).rotate().jpeg({ quality: 90 }).toFile(outPath);
    normalized.push(outPath);
  }

  return normalized;
}

module.exports = { normalizeImages };

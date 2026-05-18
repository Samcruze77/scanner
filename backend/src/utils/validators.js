const path = require("path");

const MIME_MAP = {
  pdf: ["application/pdf"],
  word: [
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  excel: [
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  image: ["image/jpeg", "image/png", "image/jpg"],
};

const EXT_MAP = {
  pdf: [".pdf"],
  word: [".doc", ".docx"],
  excel: [".xls", ".xlsx"],
  image: [".jpg", ".jpeg", ".png"],
};

function getExtension(filename = "") {
  return path.extname(filename).toLowerCase();
}

function validateMime(file, allowedTypes = []) {
  if (!file) {
    return { valid: false, message: "No file uploaded." };
  }

  const ext = getExtension(file.originalname);
  const mime = file.mimetype;

  for (const type of allowedTypes) {
    const mimes = MIME_MAP[type] || [];
    const exts = EXT_MAP[type] || [];
    if (mimes.includes(mime) && exts.includes(ext)) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    message: `Unsupported file format. Allowed: ${allowedTypes.join(", ")}`,
  };
}

function validateMultiple(files = [], allowedTypes = [], min = 1, max = 20) {
  if (!files.length) {
    return { valid: false, message: "No files uploaded." };
  }
  if (files.length < min || files.length > max) {
    return { valid: false, message: `Upload between ${min} and ${max} files.` };
  }

  for (const file of files) {
    const result = validateMime(file, allowedTypes);
    if (!result.valid) return result;
  }

  return { valid: true };
}

function parsePageRanges(input) {
  if (!input) return null;
  const ranges = [];
  const parts = String(input).split(",");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-").map((n) => Number(n));
      if (!start || !end || start > end) {
        throw new Error(`Invalid page range: ${trimmed}`);
      }
      for (let i = start; i <= end; i += 1) ranges.push(i);
    } else {
      const page = Number(trimmed);
      if (!page) throw new Error(`Invalid page number: ${trimmed}`);
      ranges.push(page);
    }
  }

  return [...new Set(ranges)].sort((a, b) => a - b);
}

module.exports = {
  validateMime,
  validateMultiple,
  parsePageRanges,
  getExtension,
};

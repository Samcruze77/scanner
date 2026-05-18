const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const env = require("../config/env");
const { ensureDir, sanitizeFilename } = require("../utils/fileUtils");

ensureDir(env.uploadDir);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const owner = req.user?.id || "anonymous";
    const uploadId = req.uploadId || uuidv4();
    req.uploadId = uploadId;
    const dir = path.join(env.uploadDir, sanitizeFilename(owner), uploadId);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = sanitizeFilename(file.originalname);
    cb(null, `${Date.now()}_${safe}`);
  },
});

function fileFilter(_req, file, cb) {
  const allowed = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.includes(ext) || file.originalname.includes("..") || path.basename(file.originalname) !== file.originalname) {
    return cb(new Error("File type not allowed."));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.maxFileSizeBytes, files: 20 },
});

module.exports = {
  single: (field) => upload.single(field),
  array: (field, max) => upload.array(field, max),
};

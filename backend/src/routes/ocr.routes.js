const express = require("express");
const ocrService = require("../services/ocrService");
const upload = require("../middleware/upload");
const virusScan = require("../middleware/virusScan");
const { authenticate } = require("../middleware/auth");
const freemiumGuard = require("../middleware/freemium");
const setConversionType = require("../middleware/setConversionType");
const { submitJob } = require("../controllers/jobController");

const router = express.Router();

router.get("/languages", (_req, res) => {
  res.json({ success: true, data: ocrService.getSupportedLanguages() });
});

router.post(
  "/extract",
  authenticate(false),
  upload.single("file"),
  virusScan,
  freemiumGuard,
  setConversionType("ocr"),
  submitJob
);

module.exports = router;

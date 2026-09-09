const express = require("express");
const upload = require("../middleware/upload");
const virusScan = require("../middleware/virusScan");
const { authenticate } = require("../middleware/auth");
const freemiumGuard = require("../middleware/freemium");
const setConversionType = require("../middleware/setConversionType");
const { submitJob } = require("../controllers/jobController");
const pdfController = require("../controllers/pdfController");

const router = express.Router();

const withJob = (type, uploadMiddleware) => [
  authenticate(false),
  uploadMiddleware,
  virusScan,
  freemiumGuard,
  setConversionType(type),
  submitJob,
];

router.post("/merge", ...withJob("pdf-merge", upload.array("files", 20)));
router.post("/split", ...withJob("pdf-split", upload.single("file")));
router.post("/compress", ...withJob("pdf-compress", upload.single("file")));
router.post("/sign", authenticate(false), upload.single("file"), pdfController.sign);

module.exports = router;

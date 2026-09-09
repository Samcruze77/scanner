const express = require("express");
const upload = require("../middleware/upload");
const virusScan = require("../middleware/virusScan");
const { authenticate } = require("../middleware/auth");
const freemiumGuard = require("../middleware/freemium");
const setConversionType = require("../middleware/setConversionType");
const { submitJob } = require("../controllers/jobController");

const router = express.Router();

const withJob = (type, uploadMiddleware) => [
  authenticate(false),
  uploadMiddleware,
  virusScan,
  freemiumGuard,
  setConversionType(type),
  submitJob,
];

router.post("/pdf-to-word", ...withJob("pdf-to-word", upload.single("file")));
router.post("/pdf-to-excel", ...withJob("pdf-to-excel", upload.single("file")));
router.post("/word-to-pdf", ...withJob("word-to-pdf", upload.single("file")));
router.post("/excel-to-pdf", ...withJob("excel-to-pdf", upload.single("file")));
router.post("/image-to-pdf", ...withJob("image-to-pdf", upload.array("files", 20)));
router.post("/ocr", ...withJob("ocr", upload.single("file")));
router.post("/pdf-merge", ...withJob("pdf-merge", upload.array("files", 20)));
router.post("/pdf-split", ...withJob("pdf-split", upload.single("file")));
router.post("/pdf-compress", ...withJob("pdf-compress", upload.single("file")));

module.exports = router;

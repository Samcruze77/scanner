const express = require("express");
const fs = require("fs");
const path = require("path");
const env = require("../config/env");
const { verifySignedLocalUrl } = require("../services/storageService");

const router = express.Router();

router.get("/:fileName", (req, res, next) => {
  const safeName = path.basename(req.params.fileName);
  if (!verifySignedLocalUrl(safeName, req.query.exp, req.query.sig)) {
    return res.status(403).json({ success: false, message: "Invalid or expired download URL." });
  }

  const filePath = path.join(env.outputDir, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "File not found or expired." });
  }

  const stat = fs.statSync(filePath);
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on("error", next);
});

module.exports = router;

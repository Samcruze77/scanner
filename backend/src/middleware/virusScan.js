const env = require("../config/env");
const analytics = require("../services/analyticsService");

/**
 * Antivirus scanning hook.
 * Integrate ClamAV, VirusTotal API, or cloud scanner here.
 */
async function virusScanHook(req, res, next) {
  if (!env.enableVirusScan) return next();

  const files = req.file ? [req.file] : req.files || [];
  for (const file of files) {
    const suspicious = [".exe", ".bat", ".cmd", ".sh", ".php", ".js", ".html", ".msi"].some((ext) =>
      file.originalname.toLowerCase().endsWith(ext)
    );

    if (suspicious) {
      await analytics.track("virus_scan_blocked", {
        userId: req.user?.id,
        metadata: { filename: file.originalname },
      });
      return res.status(400).json({ success: false, message: "File blocked by security policy." });
    }
  }

  return next();
}

module.exports = virusScanHook;

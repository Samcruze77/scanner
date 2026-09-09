const pdfService = require("../services/pdfService");
const conversionQueue = require("../services/conversionQueue");
const { validateMime, validateMultiple, parsePageRanges } = require("../utils/validators");
const { buildPublicUrl, removeFiles } = require("../utils/fileUtils");
const { logConversion } = require("../utils/analytics");

async function respond(req, res, next, type, handler, cleanupPaths = []) {
  try {
    const result = await conversionQueue.enqueue(handler);
    const downloadUrl = buildPublicUrl(result.fileName);

    logConversion("conversion_success", { type, fileName: result.fileName });

    res.json({
      success: true,
      message: "PDF operation completed successfully.",
      data: { fileName: result.fileName, downloadUrl, mimeType: result.mimeType },
    });
  } catch (error) {
    logConversion("conversion_failed", { type, error: error.message });
    next(error);
  } finally {
    await removeFiles(cleanupPaths);
  }
}

exports.merge = async (req, res, next) => {
  const validation = validateMultiple(req.files, ["pdf"], 2, 20);
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

  const paths = req.files.map((f) => f.path);
  return respond(req, res, next, "pdf-merge", () => pdfService.mergePdfs(paths), paths);
};

exports.split = async (req, res, next) => {
  const validation = validateMime(req.file, ["pdf"]);
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

  let ranges;
  try {
    ranges = parsePageRanges(req.body.pages || req.body.pageRanges);
    if (!ranges?.length) throw new Error("Page ranges are required. Example: 1-3,5");
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }

  const path = req.file.path;
  return respond(req, res, next, "pdf-split", () => pdfService.splitPdf(path, ranges), [path]);
};

exports.compress = async (req, res, next) => {
  const validation = validateMime(req.file, ["pdf"]);
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

  const path = req.file.path;
  return respond(req, res, next, "pdf-compress", () => pdfService.compressPdf(path), [path]);
};

exports.sign = async (req, res, next) => {
  const validation = validateMime(req.file, ["pdf"]);
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

  const { signature, x, y, width, height, page } = { ...req.body, ...req.query };
  const path = req.file.path;

  return respond(
    req,
    res,
    next,
    "pdf-sign",
    () => pdfService.signPdf(path, signature, { x, y, width, height, page }),
    [path]
  );
};

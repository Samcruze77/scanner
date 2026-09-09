const officeService = require("../services/officeService");
const pdfService = require("../services/pdfService");
const imageService = require("../services/imageService");
const conversionQueue = require("../services/conversionQueue");
const { validateMime, validateMultiple } = require("../utils/validators");
const { buildPublicUrl, removeFiles } = require("../utils/fileUtils");
const { logConversion } = require("../utils/analytics");

async function runConversion(req, res, next, options) {
  const inputPaths = [];
  try {
    const result = await conversionQueue.enqueue(() => options.handler(req));
    const downloadUrl = buildPublicUrl(result.fileName);

    logConversion("conversion_success", {
      type: options.type,
      fileName: result.fileName,
      fallback: result.fallback || false,
    });

    res.json({
      success: true,
      message: "Conversion completed successfully.",
      data: {
        fileName: result.fileName,
        downloadUrl,
        mimeType: result.mimeType,
        fallback: result.fallback || false,
      },
    });
  } catch (error) {
    logConversion("conversion_failed", { type: options.type, error: error.message });
    next(error);
  } finally {
    if (options.cleanup) {
      const files = options.cleanup(req);
      await removeFiles(files);
    }
  }
}

function collectSinglePath(req) {
  return req.file ? [req.file.path] : [];
}

function collectManyPaths(req) {
  return (req.files || []).map((f) => f.path);
}

exports.pdfToWord = (req, res, next) => {
  const validation = validateMime(req.file, ["pdf"]);
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

  return runConversion(req, res, next, {
    type: "pdf-to-word",
    handler: () => officeService.pdfToWord(req.file.path),
    cleanup: collectSinglePath,
  });
};

exports.pdfToExcel = (req, res, next) => {
  const validation = validateMime(req.file, ["pdf"]);
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

  return runConversion(req, res, next, {
    type: "pdf-to-excel",
    handler: () => officeService.pdfToExcel(req.file.path),
    cleanup: collectSinglePath,
  });
};

exports.wordToPdf = (req, res, next) => {
  const validation = validateMime(req.file, ["word"]);
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

  return runConversion(req, res, next, {
    type: "word-to-pdf",
    handler: () => officeService.wordToPdf(req.file.path),
    cleanup: collectSinglePath,
  });
};

exports.excelToPdf = (req, res, next) => {
  const validation = validateMime(req.file, ["excel"]);
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

  return runConversion(req, res, next, {
    type: "excel-to-pdf",
    handler: () => officeService.excelToPdf(req.file.path),
    cleanup: collectSinglePath,
  });
};

exports.imageToPdf = async (req, res, next) => {
  const validation = validateMultiple(req.files, ["image"], 1, 20);
  if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

  const tempNormalized = [];
  try {
    return await runConversion(req, res, next, {
      type: "image-to-pdf",
      handler: async () => {
        const paths = collectManyPaths(req);
        const normalized = await imageService.normalizeImages(paths);
        tempNormalized.push(...normalized);
        return pdfService.imagesToPdf(normalized);
      },
      cleanup: () => [...collectManyPaths(req), ...tempNormalized],
    });
  } catch (error) {
    await removeFiles([...collectManyPaths(req), ...tempNormalized]);
    next(error);
  }
};

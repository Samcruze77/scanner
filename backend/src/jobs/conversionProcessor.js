const fs = require("fs");
const officeService = require("../services/officeService");
const pdfService = require("../services/pdfService");
const imageService = require("../services/imageService");
const ocrService = require("../services/ocrService");
const storageService = require("../services/storageService");
const watermarkService = require("../services/watermarkService");
const historyService = require("../services/historyService");
const analyticsService = require("../services/analyticsService");
const logger = require("../config/logger");
const { removeFiles } = require("../utils/fileUtils");
const { parsePageRanges } = require("../utils/validators");

const HANDLERS = {
  "pdf-to-word": (p) => officeService.pdfToWord(p.inputPaths[0]),
  "pdf-to-excel": (p) => officeService.pdfToExcel(p.inputPaths[0]),
  "word-to-pdf": (p) => officeService.wordToPdf(p.inputPaths[0]),
  "excel-to-pdf": (p) => officeService.excelToPdf(p.inputPaths[0]),
  "image-to-pdf": async (p) => {
    const normalized = await imageService.normalizeImages(p.inputPaths);
    return pdfService.imagesToPdf(normalized);
  },
  "pdf-merge": (p) => pdfService.mergePdfs(p.inputPaths),
  "pdf-split": (p) => pdfService.splitPdf(p.inputPaths[0], parsePageRanges(p.pageRanges)),
  "pdf-compress": (p) => pdfService.compressPdf(p.inputPaths[0]),
  ocr: async (p) => {
    const ocr = await ocrService.extractText(p.inputPaths[0], p.mimeType, p.language || "eng");
    if (p.exportFormat === "docx") {
      const exported = await ocrService.exportOcrToWord(ocr);
      return { ...exported, ocr };
    }
    const exported = await ocrService.exportOcrToTxt(ocr);
    return { ...exported, ocr };
  },
};

async function processConversionJob(job) {
  const payload = job.data;
  const tempFiles = [...(payload.inputPaths || [])];
  let historyId = payload.historyId;

  try {
    logger.info("Processing conversion job", {
      jobId: job.id,
      type: payload.type,
      userId: payload.userId,
      historyId,
    });
    await job.updateProgress(10);
    const handler = HANDLERS[payload.type];
    if (!handler) throw new Error(`Unknown conversion type: ${payload.type}`);

    let optimizedPaths = payload.inputPaths;
    if (payload.type === "image-to-pdf" || payload.type === "ocr") {
      optimizedPaths = await Promise.all(
        payload.inputPaths.map((p) => storageService.optimizeUpload(p))
      );
    }

    await job.updateProgress(40);
    const result = await handler({ ...payload, inputPaths: optimizedPaths });

    if (result.mimeType === "application/pdf" && payload.plan !== "pro") {
      await watermarkService.applyPdfWatermark(result.outputPath, payload.plan || "free");
    }

    await job.updateProgress(70);
    const stored = await storageService.uploadLocalFile(result.outputPath);

    if (historyId) {
      await historyService.markHistorySuccess(historyId, {
        convertedFilename: stored.fileName,
        downloadUrl: stored.downloadUrl,
        storageKey: stored.storageKey,
      });
    }

    await analyticsService.track("conversion_success", {
      userId: payload.userId,
      conversionType: payload.type,
    });

    await job.updateProgress(100);
    logger.info("Conversion job output stored", {
      jobId: job.id,
      storageKey: stored.storageKey,
      fileName: stored.fileName,
    });

    const response = {
      fileName: stored.fileName,
      downloadUrl: stored.downloadUrl,
      storageKey: stored.storageKey,
      mimeType: result.mimeType,
      fallback: result.fallback || false,
    };

    if (result.ocr) {
      response.ocr = {
        text: result.ocr.text,
        confidence: result.ocr.confidence,
        language: result.ocr.language,
        source: result.ocr.source,
        pages: result.ocr.pages,
      };
    }

    return response;
  } catch (error) {
    logger.error("Conversion job processing failed", {
      jobId: job.id,
      type: payload.type,
      userId: payload.userId,
      error,
    });
    if (historyId) {
      await historyService.markHistoryFailed(historyId, error.message);
    }
    await analyticsService.track("conversion_failed", {
      userId: payload.userId,
      conversionType: payload.type,
      metadata: { error: error.message },
    });
    throw error;
  } finally {
    await removeFiles(tempFiles);
    if (payload.outputPath) {
      await fs.promises.unlink(payload.outputPath).catch(() => {});
    }
  }
}

module.exports = { processConversionJob };

const { enqueueConversionJob, getJobStatus } = require("../services/queueService");
const historyService = require("../services/historyService");
const { getJobTracking } = require("../services/jobTrackingService");
const { createJobRecord } = require("../services/jobMetadataService");
const { validateMime, validateMultiple } = require("../utils/validators");
const { cacheGet, cacheSet } = require("../services/cacheService");

const TYPE_VALIDATORS = {
  "pdf-to-word": (req) => validateMime(req.file, ["pdf"]),
  "pdf-to-excel": (req) => validateMime(req.file, ["pdf"]),
  "word-to-pdf": (req) => validateMime(req.file, ["word"]),
  "excel-to-pdf": (req) => validateMime(req.file, ["excel"]),
  "image-to-pdf": (req) => validateMultiple(req.files, ["image"], 1, 20),
  "pdf-merge": (req) => validateMultiple(req.files, ["pdf"], 2, 20),
  "pdf-split": (req) => validateMime(req.file, ["pdf"]),
  "pdf-compress": (req) => validateMime(req.file, ["pdf"]),
  "pdf-sign": (req) => validateMime(req.file, ["pdf"]),
  ocr: (req) => validateMime(req.file, ["pdf", "image"]),
};

function collectPaths(req) {
  if (req.files?.length) return req.files.map((f) => f.path);
  if (req.file) return [req.file.path];
  return [];
}

function collectNames(req) {
  if (req.files?.length) return req.files.map((f) => f.originalname);
  if (req.file) return [req.file.originalname];
  return [];
}

async function submitJob(req, res, next) {
  try {
    const type = req.conversionType;
    const validation = TYPE_VALIDATORS[type]?.(req);
    if (validation && !validation.valid) {
      return res.status(400).json({ success: false, message: validation.message });
    }

    const inputPaths = collectPaths(req);
    const uploadedFiles = req.files || (req.file ? [req.file] : []);
    const originalFilename = collectNames(req).join(", ");
    const totalSize = uploadedFiles.reduce((s, f) => s + (f.size || 0), 0);

    const historyId = await historyService.createHistoryEntry({
      userId: req.user?.id,
      jobId: null,
      originalFilename,
      conversionType: type,
      fileSizeBytes: totalSize,
    });

    const { jobId } = await enqueueConversionJob({
      type,
      inputPaths,
      userId: req.user?.id,
      plan: req.user?.plan || "free",
      historyId,
      pageRanges: req.body.pages || req.body.pageRanges,
      signature: req.body.signature,
      signaturePlacement: {
        page: req.body.signaturePage,
        x: req.body.signatureX,
        y: req.body.signatureY,
        width: req.body.signatureWidth,
        height: req.body.signatureHeight,
      },
      language: req.body.language || "eng",
      exportFormat: req.body.exportFormat || "txt",
      mimeType: req.file?.mimetype || req.files?.[0]?.mimetype,
    });

    await require("../config/database").pool.query(
      `UPDATE conversion_history
          SET job_id = $2, status = 'queued', progress_percentage = 0
        WHERE id = $1`,
      [historyId, String(jobId)]
    );

    await createJobRecord({
      jobId,
      historyId,
      userId: req.user?.id,
      conversionType: type,
      files: uploadedFiles,
    });

    res.status(202).json({
      success: true,
      message: "Conversion queued.",
      data: { jobId, historyId, status: "queued" },
    });
  } catch (error) {
    next(error);
  }
}

async function getJob(req, res, next) {
  try {
    const cacheKey = `job:${req.params.jobId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const status = await getJobStatus(req.params.jobId);
    if (!status) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }

    const tracking = await getJobTracking(req.params.jobId);
    const data = {
      jobId: status.jobId,
      state: status.state,
      status: status.status || tracking?.status,
      progress: status.progress,
      retryCount: status.retryCount ?? tracking?.retry_count ?? 0,
      processingTimeMs: status.processingTimeMs ?? tracking?.processing_time_ms ?? null,
      result: status.result,
      error: status.failedReason || tracking?.error_message,
    };

    if (status.state === "completed") {
      await cacheSet(cacheKey, data, 600);
    }

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { submitJob, getJob };

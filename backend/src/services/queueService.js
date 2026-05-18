const { Queue, QueueEvents, Worker } = require("bullmq");
const { getRedis } = require("../config/redis");
const env = require("../config/env");
const logger = require("../config/logger");
const { emitJobUpdate } = require("./socketService");
const { getJobTracking, updateJobTracking } = require("./jobTrackingService");
const { notifyJobUpdate } = require("./pushNotificationService");

const QUEUE_NAME = "document-conversions";

let conversionQueue;
let deadLetterQueue;
let queueEvents;

function getConversionQueue() {
  if (!conversionQueue) {
    conversionQueue = new Queue(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: env.jobAttempts,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { age: 3600, count: 500 },
        removeOnFail: { age: 86400, count: 200 },
      },
    });
  }
  return conversionQueue;
}

function getDeadLetterQueue() {
  if (!deadLetterQueue) {
    deadLetterQueue = new Queue(env.deadLetterQueueName, {
      connection: getRedis(),
      defaultJobOptions: {
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
      },
    });
  }
  return deadLetterQueue;
}

function createConversionWorker(processor) {
  return new Worker(QUEUE_NAME, processor, {
    connection: getRedis(),
    concurrency: env.queueConcurrency,
    lockDuration: env.jobTimeoutMs,
  });
}

async function enqueueConversionJob(payload) {
  const queue = getConversionQueue();
  const job = await queue.add(payload.type, payload, {
    timeout: env.jobTimeoutMs,
  });
  logger.info("Conversion job queued", {
    jobId: job.id,
    type: payload.type,
    userId: payload.userId,
    historyId: payload.historyId,
  });
  return { jobId: job.id };
}

async function getJobStatus(jobId) {
  const job = await getConversionQueue().getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  return {
    jobId: job.id,
    state,
    status: normalizeBullState(state),
    progress: normalizeProgress(job.progress),
    result: job.returnvalue,
    failedReason: job.failedReason,
    retryCount: Math.max(0, job.attemptsMade || 0),
    processingTimeMs: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
  };
}

function normalizeProgress(progress) {
  if (typeof progress === "number") return Math.max(0, Math.min(100, Math.round(progress)));
  const parsed = Number(progress);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0;
}

function normalizeBullState(state) {
  if (state === "waiting" || state === "delayed" || state === "prioritized") return "queued";
  if (state === "active") return "processing";
  if (state === "completed") return "completed";
  if (state === "failed") return "failed";
  return state || "queued";
}

async function buildUpdate(jobId, patch = {}) {
  const status = await getJobStatus(jobId);
  const tracking = await getJobTracking(jobId);
  return {
    jobId: String(jobId),
    historyId: tracking?.id,
    userId: tracking?.user_id,
    conversionType: tracking?.conversion_type,
    status: patch.status || status?.status || tracking?.status || "queued",
    state: status?.state,
    progress: patch.progress ?? status?.progress ?? tracking?.progress_percentage ?? 0,
    retryCount: patch.retryCount ?? status?.retryCount ?? tracking?.retry_count ?? 0,
    processingTimeMs: status?.processingTimeMs ?? tracking?.processing_time_ms ?? null,
    result: patch.result ?? status?.result ?? null,
    error: patch.error ?? status?.failedReason ?? tracking?.error_message ?? null,
  };
}

function startJobEventBridge() {
  if (queueEvents) return queueEvents;

  queueEvents = new QueueEvents(QUEUE_NAME, { connection: getRedis() });

  queueEvents.on("waiting", async ({ jobId }) => {
    const tracking = await updateJobTracking(jobId, { status: "queued", progress: 0 });
    logger.info("Conversion job waiting", { jobId });
    emitJobUpdate(await buildUpdate(jobId, { status: tracking?.status || "queued", progress: 0 }));
  });

  queueEvents.on("active", async ({ jobId, prev }) => {
    const job = await getConversionQueue().getJob(jobId);
    const retryCount = Math.max(0, job?.attemptsMade || 0);
    const tracking = await updateJobTracking(jobId, {
      status: "processing",
      progress: prev === "failed" ? 1 : 10,
      retryCount,
    });
    logger.info("Conversion job active", { jobId, retryCount });
    emitJobUpdate(await buildUpdate(jobId, {
      status: tracking?.status || "processing",
      progress: tracking?.progress_percentage ?? 10,
      retryCount,
    }));
  });

  queueEvents.on("progress", async ({ jobId, data }) => {
    const progress = normalizeProgress(data);
    const tracking = await updateJobTracking(jobId, { status: "processing", progress });
    logger.debug("Conversion job progress", { jobId, progress });
    emitJobUpdate(await buildUpdate(jobId, {
      status: tracking?.status || "processing",
      progress,
    }));
  });

  queueEvents.on("completed", async ({ jobId, returnvalue }) => {
    let result = returnvalue;
    if (typeof returnvalue === "string") {
      try {
        result = JSON.parse(returnvalue || "null");
      } catch {
        result = returnvalue;
      }
    }
    const tracking = await updateJobTracking(jobId, { status: "completed", progress: 100, result });
    logger.info("Conversion job completed", { jobId, userId: tracking?.user_id });
    const update = await buildUpdate(jobId, {
      status: "completed",
      progress: 100,
      result,
    });
    emitJobUpdate(update);
    await notifyJobUpdate({
      userId: tracking?.user_id,
      jobId: String(jobId),
      type: tracking?.conversion_type === "ocr" ? "ocr_completed" : "conversion_completed",
      title: tracking?.conversion_type === "ocr" ? "OCR finished" : "Conversion complete",
      body: tracking?.conversion_type === "ocr" ? "Your extracted text is ready." : "Your converted document is ready.",
      result: update.result,
    });
  });

  queueEvents.on("failed", async ({ jobId, failedReason }) => {
    const job = await getConversionQueue().getJob(jobId);
    const retryCount = Math.max(0, job?.attemptsMade || 0);
    const state = job ? await job.getState() : "failed";
    const status = normalizeBullState(state);
    const tracking = await updateJobTracking(jobId, {
      status,
      progress: status === "failed" ? 100 : normalizeProgress(job?.progress),
      retryCount,
      errorMessage: failedReason,
    });
    const update = await buildUpdate(jobId, {
      status,
      retryCount,
      error: failedReason,
    });
    emitJobUpdate(update);
    if (status === "failed") {
      await getDeadLetterQueue().add("failed-conversion", {
        originalJobId: String(jobId),
        failedReason,
        payload: job?.data,
        attemptsMade: retryCount,
        failedAt: new Date().toISOString(),
      });
      logger.error("Conversion job permanently failed and moved to dead letter queue", {
        jobId,
        failedReason,
        retryCount,
      });
      await notifyJobUpdate({
        userId: tracking?.user_id,
        jobId: String(jobId),
        type: "job_failed",
        title: "Job failed",
        body: failedReason || "Document processing failed.",
      });
    } else {
      logger.warn("Conversion job failed attempt, retry pending", { jobId, failedReason, retryCount });
    }
  });

  queueEvents.on("error", (error) => {
    logger.error("Queue event bridge error", { error });
  });

  return queueEvents;
}

module.exports = {
  getConversionQueue,
  getDeadLetterQueue,
  createConversionWorker,
  enqueueConversionJob,
  getJobStatus,
  startJobEventBridge,
};

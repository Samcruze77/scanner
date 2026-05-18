const { createConversionWorker } = require("./services/queueService");
const { processConversionJob } = require("./jobs/conversionProcessor");
const { startCleanupScheduler } = require("./services/cleanupService");
const logger = require("./config/logger");

logger.info("Starting conversion worker", {
  concurrency: require("./config/env").queueConcurrency,
});

startCleanupScheduler();

const worker = createConversionWorker(async (job) => processConversionJob(job));

worker.on("completed", (job) => {
  logger.info("Worker completed job", { jobId: job.id, type: job.name });
});

worker.on("failed", (job, err) => {
  logger.error("Worker failed job", {
    jobId: job?.id,
    type: job?.name,
    attemptsMade: job?.attemptsMade,
    error: err,
  });
});

worker.on("stalled", (jobId) => {
  logger.warn("Worker job stalled", { jobId });
});

worker.on("error", (error) => {
  logger.error("Worker runtime error", { error });
});

process.on("SIGTERM", async () => {
  logger.info("Worker received SIGTERM, closing");
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("Worker received SIGINT, closing");
  await worker.close();
  process.exit(0);
});

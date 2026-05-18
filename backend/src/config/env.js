require("dotenv").config();

const mb = Number(process.env.MAX_FILE_SIZE_MB || 25);

module.exports = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`,
  maxFileSizeBytes: mb * 1024 * 1024,
  uploadDir: process.env.UPLOAD_DIR || "./uploads/temp",
  outputDir: process.env.OUTPUT_DIR || "./uploads/output",
  deadLetterQueueName: process.env.DEAD_LETTER_QUEUE_NAME || "document-conversions-dlq",
  fileTtlHours: Number(process.env.FILE_TTL_HOURS || 24),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "change-refresh-secret-in-production",
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  databaseUrl: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/converter",
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY || 3),
  jobTimeoutMs: Number(process.env.JOB_TIMEOUT_MS || 300000),
  jobAttempts: Number(process.env.JOB_ATTEMPTS || 3),
  storageProvider: process.env.STORAGE_PROVIDER || "local",
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET || "",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
    priceProMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY || "",
  },
  freemium: {
    freeDailyLimit: Number(process.env.FREE_DAILY_LIMIT || 5),
    enableWatermark: process.env.ENABLE_WATERMARK_FREE !== "false",
  },
  enableVirusScan: process.env.ENABLE_VIRUS_SCAN === "true",
  ocrLanguages: (process.env.OCR_LANGUAGES || "eng").split(","),
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS || 300),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    iosClientId: process.env.GOOGLE_IOS_CLIENT_ID || "",
    androidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID || "",
  },
  apple: {
    clientId: process.env.APPLE_CLIENT_ID || "com.anonymous.documentscanner",
  },
};

const winston = require("winston");
const env = require("./env");

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (env.nodeEnv === "production" ? "info" : "debug"),
  defaultMeta: {
    service: process.env.SERVICE_NAME || "document-converter",
    environment: env.nodeEnv,
  },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

module.exports = logger;

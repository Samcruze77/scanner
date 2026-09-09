const logger = require("../config/logger");

function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  const message = err.message || "Internal server error";

  logger.error("Request failed", { status, error: err });

  res.status(status).json({
    success: false,
    message,
    code: err.code,
  });
}

module.exports = errorHandler;

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const env = require("./config/env");
const errorHandler = require("./middleware/errorHandler");
const healthRoutes = require("./routes/health.routes");
const authRoutes = require("./routes/auth.routes");
const convertRoutes = require("./routes/convert.routes");
const pdfRoutes = require("./routes/pdf.routes");
const filesRoutes = require("./routes/files.routes");
const ocrRoutes = require("./routes/ocr.routes");
const jobsRoutes = require("./routes/jobs.routes");
const historyRoutes = require("./routes/history.routes");
const billingRoutes = require("./routes/billing.routes");
const stripeWebhook = require("./routes/billing.webhook");
const analyticsRoutes = require("./routes/analytics.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const signatureRoutes = require("./routes/signature.routes");
const documentRoutes = require("./routes/document.routes");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin === "*" ? true : env.corsOrigin.split(","),
  })
);
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

app.use("/billing/webhook", express.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many upload requests." },
});

app.use(healthRoutes);
app.use("/auth", authRoutes);
app.use("/convert", uploadLimiter, convertRoutes);
app.use("/pdf", uploadLimiter, pdfRoutes);
app.use("/ocr", uploadLimiter, ocrRoutes);
app.use("/jobs", jobsRoutes);
app.use("/history", historyRoutes);
app.use("/billing", billingRoutes);
app.use("/analytics", analyticsRoutes);
app.use("/files", filesRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/signatures", signatureRoutes);
app.use("/documents", documentRoutes);

app.use(errorHandler);

module.exports = app;

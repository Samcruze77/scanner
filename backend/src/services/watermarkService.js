const fs = require("fs");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const env = require("../config/env");

async function applyPdfWatermark(inputPath, plan = "free") {
  if (plan === "pro" || !env.freemium.enableWatermark) {
    return inputPath;
  }

  const bytes = await fs.promises.readFile(inputPath);
  const pdfDoc = await PDFDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  pages.forEach((page) => {
    const { width, height } = page.getSize();
    page.drawText("Scanned with Document Scanner - Free Plan", {
      x: width * 0.1,
      y: height * 0.05,
      size: 10,
      font,
      color: rgb(0.6, 0.6, 0.6),
      opacity: 0.5,
    });
  });

  const outputBytes = await pdfDoc.save();
  await fs.promises.writeFile(inputPath, outputBytes);
  return inputPath;
}

module.exports = { applyPdfWatermark };

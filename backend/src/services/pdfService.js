const fs = require("fs");
const { PDFDocument } = require("pdf-lib");
const { buildOutputPath, getFileNameFromPath } = require("../utils/fileUtils");

async function mergePdfs(inputPaths) {
  const mergedPdf = await PDFDocument.create();

  for (const inputPath of inputPaths) {
    const bytes = await fs.promises.readFile(inputPath);
    const pdf = await PDFDocument.load(bytes);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => mergedPdf.addPage(page));
  }

  const outputPath = buildOutputPath("pdf");
  const pdfBytes = await mergedPdf.save({ useObjectStreams: true });
  await fs.promises.writeFile(outputPath, pdfBytes);

  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/pdf",
  };
}

async function splitPdf(inputPath, pageRanges) {
  const bytes = await fs.promises.readFile(inputPath);
  const source = await PDFDocument.load(bytes);
  const totalPages = source.getPageCount();

  const outputPdf = await PDFDocument.create();
  const zeroBased = pageRanges.map((p) => p - 1).filter((p) => p >= 0 && p < totalPages);

  if (!zeroBased.length) {
    throw new Error("No valid pages selected for split.");
  }

  const copied = await outputPdf.copyPages(source, zeroBased);
  copied.forEach((page) => outputPdf.addPage(page));

  const outputPath = buildOutputPath("pdf");
  const pdfBytes = await outputPdf.save();
  await fs.promises.writeFile(outputPath, pdfBytes);

  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/pdf",
  };
}

async function compressPdf(inputPath) {
  const bytes = await fs.promises.readFile(inputPath);
  const pdf = await PDFDocument.load(bytes);
  const outputPath = buildOutputPath("pdf");
  const compressed = await pdf.save({ useObjectStreams: true });
  await fs.promises.writeFile(outputPath, compressed);

  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/pdf",
  };
}

function decodeSignaturePng(signature) {
  if (!signature) {
    throw new Error("Signature is required.");
  }

  const base64 = String(signature).replace(/^data:image\/png;base64,/, "");
  return Buffer.from(base64, "base64");
}

async function signPdf(inputPath, signature, options = {}) {
  const pdfBytes = await fs.promises.readFile(inputPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const pageIndex = Math.max(0, Math.min(Number(options.page || 1) - 1, pages.length - 1));
  const page = pages[pageIndex];

  const pngImage = await pdfDoc.embedPng(decodeSignaturePng(signature));
  page.drawImage(pngImage, {
    x: Number(options.x ?? 100),
    y: Number(options.y ?? 100),
    width: Number(options.width ?? 150),
    height: Number(options.height ?? 50),
  });

  const outputPath = buildOutputPath("pdf");
  const signed = await pdfDoc.save({ useObjectStreams: true });
  await fs.promises.writeFile(outputPath, signed);

  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/pdf",
  };
}

async function imagesToPdf(imagePaths) {
  const pdfDoc = await PDFDocument.create();

  for (const imagePath of imagePaths) {
    const imageBytes = await fs.promises.readFile(imagePath);
    const ext = imagePath.toLowerCase();

    let embedded;
    if (ext.endsWith(".png")) {
      embedded = await pdfDoc.embedPng(imageBytes);
    } else {
      embedded = await pdfDoc.embedJpg(imageBytes);
    }

    const { width, height } = embedded.scale(1);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
  }

  const outputPath = buildOutputPath("pdf");
  const pdfBytes = await pdfDoc.save();
  await fs.promises.writeFile(outputPath, pdfBytes);

  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/pdf",
  };
}

module.exports = {
  mergePdfs,
  splitPdf,
  compressPdf,
  signPdf,
  imagesToPdf,
};

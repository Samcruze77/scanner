const fs = require("fs");
const { promisify } = require("util");
const libre = require("libreoffice-convert");
const pdfParse = require("pdf-parse");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const XLSX = require("xlsx");
const { buildOutputPath, getFileNameFromPath } = require("../utils/fileUtils");

const libreConvert = promisify(libre.convert);

async function convertWithLibre(inputBuffer, extension) {
  return libreConvert(inputBuffer, extension, undefined);
}

async function pdfToWord(inputPath) {
  try {
    const inputBuffer = await fs.promises.readFile(inputPath);
    const outputBuffer = await convertWithLibre(inputBuffer, ".docx");
    const outputPath = buildOutputPath("docx");
    await fs.promises.writeFile(outputPath, outputBuffer);
    return {
      outputPath,
      fileName: getFileNameFromPath(outputPath),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  } catch (error) {
    return pdfToWordFallback(inputPath);
  }
}

async function pdfToWordFallback(inputPath) {
  const buffer = await fs.promises.readFile(inputPath);
  const parsed = await pdfParse(buffer);
  const lines = (parsed.text || "").split("\n").filter(Boolean);

  const doc = new Document({
    sections: [
      {
        children: lines.length
          ? lines.map((line) => new Paragraph({ children: [new TextRun(line)] }))
          : [new Paragraph({ children: [new TextRun("No extractable text found in PDF.")] })],
      },
    ],
  });

  const outputPath = buildOutputPath("docx");
  const outputBuffer = await Packer.toBuffer(doc);
  await fs.promises.writeFile(outputPath, outputBuffer);

  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fallback: true,
  };
}

async function pdfToExcel(inputPath) {
  try {
    const inputBuffer = await fs.promises.readFile(inputPath);
    const outputBuffer = await convertWithLibre(inputBuffer, ".xlsx");
    const outputPath = buildOutputPath("xlsx");
    await fs.promises.writeFile(outputPath, outputBuffer);
    return {
      outputPath,
      fileName: getFileNameFromPath(outputPath),
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  } catch (error) {
    return pdfToExcelFallback(inputPath);
  }
}

async function pdfToExcelFallback(inputPath) {
  const buffer = await fs.promises.readFile(inputPath);
  const parsed = await pdfParse(buffer);
  const rows = (parsed.text || "")
    .split("\n")
    .filter(Boolean)
    .map((line, index) => ({ Row: index + 1, Content: line }));

  const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Row: 1, Content: "No extractable text" }]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Extracted");
  const outputPath = buildOutputPath("xlsx");
  XLSX.writeFile(workbook, outputPath);

  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fallback: true,
  };
}

async function wordToPdf(inputPath) {
  const inputBuffer = await fs.promises.readFile(inputPath);
  const outputBuffer = await convertWithLibre(inputBuffer, ".pdf");
  const outputPath = buildOutputPath("pdf");
  await fs.promises.writeFile(outputPath, outputBuffer);

  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/pdf",
  };
}

async function excelToPdf(inputPath) {
  const inputBuffer = await fs.promises.readFile(inputPath);
  const outputBuffer = await convertWithLibre(inputBuffer, ".pdf");
  const outputPath = buildOutputPath("pdf");
  await fs.promises.writeFile(outputPath, outputBuffer);

  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/pdf",
  };
}

module.exports = {
  pdfToWord,
  pdfToExcel,
  wordToPdf,
  excelToPdf,
};

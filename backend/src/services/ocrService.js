const fs = require("fs");
const path = require("path");
const Tesseract = require("tesseract.js");
const pdfParse = require("pdf-parse");
const sharp = require("sharp");
const { Document, Packer, Paragraph, TextRun } = require("docx");
const { buildOutputPath, getFileNameFromPath } = require("../utils/fileUtils");

const SUPPORTED_LANGUAGES = [
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
  { code: "deu", label: "German" },
  { code: "ita", label: "Italian" },
  { code: "por", label: "Portuguese" },
  { code: "ara", label: "Arabic" },
  { code: "chi_sim", label: "Chinese (Simplified)" },
];

async function recognizeImage(imagePath, language = "eng") {
  const result = await Tesseract.recognize(imagePath, language, {
    logger: () => {},
  });

  return {
    text: result.data.text || "",
    confidence: result.data.confidence,
    language,
  };
}

async function extractFromPdf(inputPath, language = "eng") {
  const buffer = await fs.promises.readFile(inputPath);
  const parsed = await pdfParse(buffer);

  if ((parsed.text || "").trim().length > 80) {
    return {
      text: parsed.text,
      confidence: 100,
      language,
      source: "pdf-text-layer",
      pages: [{ page: 1, text: parsed.text, confidence: 100 }],
    };
  }

  return extractFromPdfViaOcr(inputPath, language);
}

async function extractFromPdfViaOcr(inputPath, language) {
  const { pdf } = await import("pdf-to-img");
  const document = await pdf(inputPath, { scale: 2 });
  const pages = [];
  let fullText = "";
  let pageNum = 1;

  for await (const image of document) {
    const tempPath = path.join(path.dirname(inputPath), `ocr_page_${pageNum}.png`);
    await fs.promises.writeFile(tempPath, image);
    const pageResult = await recognizeImage(tempPath, language);
    pages.push({ page: pageNum, text: pageResult.text, confidence: pageResult.confidence });
    fullText += `${pageResult.text}\n`;
    await fs.promises.unlink(tempPath).catch(() => {});
    pageNum += 1;
  }

  const avgConfidence = pages.length
    ? pages.reduce((sum, p) => sum + (p.confidence || 0), 0) / pages.length
    : 0;

  return {
    text: fullText.trim(),
    confidence: avgConfidence,
    language,
    source: "tesseract-ocr",
    pages,
  };
}

async function extractText(inputPath, mimeType, language = "eng") {
  const ext = path.extname(inputPath).toLowerCase();

  if (mimeType?.startsWith("image/") || [".jpg", ".jpeg", ".png"].includes(ext)) {
    const normalized = path.join(path.dirname(inputPath), `ocr_${path.basename(inputPath)}`);
    await sharp(inputPath).rotate().png().toFile(normalized);
    const result = await recognizeImage(normalized, language);
    await fs.promises.unlink(normalized).catch(() => {});
    return { ...result, source: "tesseract-ocr", pages: [{ page: 1, ...result }] };
  }

  if (ext === ".pdf" || mimeType === "application/pdf") {
    return extractFromPdf(inputPath, language);
  }

  throw new Error("Unsupported file type for OCR. Use PDF, JPG, or PNG.");
}

async function exportOcrToTxt(ocrResult) {
  const outputPath = buildOutputPath("txt");
  await fs.promises.writeFile(outputPath, ocrResult.text || "", "utf8");
  return { outputPath, fileName: getFileNameFromPath(outputPath), mimeType: "text/plain" };
}

async function exportOcrToWord(ocrResult) {
  const lines = (ocrResult.text || "").split("\n").filter(Boolean);
  const doc = new Document({
    sections: [
      {
        children: lines.length
          ? lines.map((line) => new Paragraph({ children: [new TextRun(line)] }))
          : [new Paragraph({ children: [new TextRun("No text extracted.")] })],
      },
    ],
  });
  const outputPath = buildOutputPath("docx");
  await fs.promises.writeFile(outputPath, await Packer.toBuffer(doc));
  return {
    outputPath,
    fileName: getFileNameFromPath(outputPath),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

function getSupportedLanguages() {
  return SUPPORTED_LANGUAGES;
}

module.exports = {
  extractText,
  exportOcrToTxt,
  exportOcrToWord,
  getSupportedLanguages,
};

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const cloudinary = require("cloudinary").v2;
const env = require("../config/env");
const { buildOutputPath, getFileNameFromPath } = require("../utils/fileUtils");

let s3Client;

function initCloudinary() {
  if (env.cloudinary.cloudName) {
    cloudinary.config({
      cloud_name: env.cloudinary.cloudName,
      api_key: env.cloudinary.apiKey,
      api_secret: env.cloudinary.apiSecret,
    });
  }
}

function getS3() {
  if (!s3Client && env.aws.bucket) {
    s3Client = new S3Client({
      region: env.aws.region,
      credentials: {
        accessKeyId: env.aws.accessKeyId,
        secretAccessKey: env.aws.secretAccessKey,
      },
    });
  }
  return s3Client;
}

async function uploadLocalFile(filePath, keyPrefix = "converted") {
  const fileName = getFileNameFromPath(filePath);
  const key = `${keyPrefix}/${fileName}`;
  const buffer = await fs.promises.readFile(filePath);
  const mimeType = guessMime(fileName);

  if (env.storageProvider === "s3" && env.aws.bucket) {
    const client = getS3();
    await client.send(
      new PutObjectCommand({
        Bucket: env.aws.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );
    const signedUrl = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: env.aws.bucket, Key: key }),
      { expiresIn: 3600 }
    );
    return { storageKey: key, downloadUrl: signedUrl, fileName };
  }

  if (env.storageProvider === "cloudinary" && env.cloudinary.cloudName) {
    initCloudinary();
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: "auto",
      folder: "document-converter",
    });
    return { storageKey: result.public_id, downloadUrl: result.secure_url, fileName };
  }

  return {
    storageKey: fileName,
    downloadUrl: buildSignedLocalUrl(fileName),
    fileName,
  };
}

async function getSignedDownloadUrl(storageKey) {
  if (env.storageProvider === "s3" && env.aws.bucket) {
    const client = getS3();
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: env.aws.bucket, Key: storageKey }),
      { expiresIn: 3600 }
    );
  }
  if (env.storageProvider === "cloudinary") {
    initCloudinary();
    return cloudinary.url(storageKey, { secure: true, sign_url: true });
  }
  return buildSignedLocalUrl(path.basename(storageKey));
}

async function deleteStoredFile(storageKey) {
  if (env.storageProvider === "s3" && env.aws.bucket) {
    const client = getS3();
    await client.send(new DeleteObjectCommand({ Bucket: env.aws.bucket, Key: storageKey }));
    return;
  }
  if (env.storageProvider === "cloudinary") {
    initCloudinary();
    await cloudinary.uploader.destroy(storageKey, { resource_type: "raw" }).catch(() => {});
  }
}

async function optimizeUpload(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg", ".png"].includes(ext)) {
    const optimized = filePath.replace(ext, `_opt${ext}`);
    const sharp = require("sharp");
    await sharp(filePath).rotate().jpeg({ quality: 82, mozjpeg: true }).toFile(optimized);
    return optimized;
  }
  return filePath;
}

function guessMime(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const map = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".json": "application/json",
  };
  return map[ext] || "application/octet-stream";
}

function buildSignedLocalUrl(fileName, expiresInSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const safeName = path.basename(fileName);
  const signature = crypto
    .createHmac("sha256", env.jwtSecret)
    .update(`${safeName}:${exp}`)
    .digest("hex");
  return `${env.apiBaseUrl}/files/${safeName}?exp=${exp}&sig=${signature}`;
}

function verifySignedLocalUrl(fileName, exp, signature) {
  const safeName = path.basename(fileName);
  const expiresAt = Number(exp);
  if (!expiresAt || expiresAt < Math.floor(Date.now() / 1000) || !signature) return false;
  const expected = crypto
    .createHmac("sha256", env.jwtSecret)
    .update(`${safeName}:${expiresAt}`)
    .digest("hex");
  const actual = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(expectedBuffer, actual);
}

module.exports = {
  uploadLocalFile,
  getSignedDownloadUrl,
  deleteStoredFile,
  optimizeUpload,
  buildOutputPath,
  verifySignedLocalUrl,
};

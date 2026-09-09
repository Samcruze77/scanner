const documentService = require("../services/documentService");
const { buildPublicUrl } = require("../utils/fileUtils");

exports.upload = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const userId = req.user?.id;
    const { filename, size } = req.file;
    const fileUrl = buildPublicUrl(req.file.filename);

    const doc = await documentService.createDocument({
      userId,
      filename: req.body.filename || req.query.filename || filename,
      fileSize: req.body.size || req.query.size || size,
      fileUrl,
    });

    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    next(error);
  }
};

exports.getById = async (req, res, next) => {
  try {
    const doc = await documentService.getDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    res.json({ success: true, data: doc });
  } catch (error) {
    next(error);
  }
};

exports.compress = async (req, res, next) => {
  try {
    const doc = await documentService.compressDocument(req.body.id);
    res.json({ success: true, data: doc });
  } catch (error) {
    next(error);
  }
};

exports.sign = async (req, res, next) => {
  try {
    const { id, signature, x, y, width, height, page } = req.body;
    const doc = await documentService.signDocument(id, signature, { x, y, width, height, page });
    res.json({ success: true, data: doc });
  } catch (error) {
    next(error);
  }
};

exports.exportDoc = async (req, res, next) => {
  try {
    const { id, format } = req.body;
    const exported = await documentService.exportDocument(id, format);
    res.json({ success: true, data: exported });
  } catch (error) {
    next(error);
  }
};

exports.download = async (req, res, next) => {
  try {
    const doc = await documentService.getDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    // In a real app, this might redirect to a signed S3 URL or stream the file
    res.redirect(doc.file_url);
  } catch (error) {
    next(error);
  }
};

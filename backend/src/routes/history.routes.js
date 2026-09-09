const express = require("express");
const historyService = require("../services/historyService");
const storageService = require("../services/storageService");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate(), async (req, res, next) => {
  try {
    const items = await historyService.listHistory(req.user.id);
    res.json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", authenticate(), async (req, res, next) => {
  try {
    const item = await historyService.getHistoryById(req.params.id, req.user.id);
    if (!item) return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/download", authenticate(), async (req, res, next) => {
  try {
    const item = await historyService.getHistoryById(req.params.id, req.user.id);
    if (!item?.storage_key) {
      return res.status(404).json({ success: false, message: "File unavailable." });
    }
    const url = await storageService.getSignedDownloadUrl(item.storage_key);
    res.json({ success: true, data: { downloadUrl: url } });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", authenticate(), async (req, res, next) => {
  try {
    const item = await historyService.getHistoryById(req.params.id, req.user.id);
    if (item?.storage_key) {
      await storageService.deleteStoredFile(item.storage_key).catch(() => {});
    }
    await historyService.deleteHistory(req.params.id, req.user.id);
    res.json({ success: true, message: "History entry deleted." });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

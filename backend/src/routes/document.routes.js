const express = require("express");
const documentController = require("../controllers/documentController");
const upload = require("../middleware/upload");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.use(authenticate(false));

router.post("/upload", upload.single("file"), documentController.upload);
router.post("/compress", documentController.compress);
router.post("/sign", documentController.sign);
router.post("/export", documentController.exportDoc);
router.get("/:id/download", documentController.download);
router.get("/:id", documentController.getById);

module.exports = router;

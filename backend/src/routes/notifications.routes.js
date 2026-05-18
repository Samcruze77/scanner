const express = require("express");
const { registerPushToken, updateSettings } = require("../controllers/notificationController");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.post("/push-token", authenticate(true), registerPushToken);
router.patch("/settings", authenticate(true), updateSettings);

module.exports = router;

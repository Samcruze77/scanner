const express = require("express");
const signatureController = require("../controllers/signatureController");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.post("/", authenticate(false), signatureController.save);

module.exports = router;

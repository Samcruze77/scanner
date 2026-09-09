const express = require("express");
const { getJob } = require("../controllers/jobController");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.get("/:jobId", authenticate(false), getJob);

module.exports = router;

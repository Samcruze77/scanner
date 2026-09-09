const express = require("express");
const rateLimit = require("express-rate-limit");
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: "Too many auth requests. Try again later." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many login attempts. Try again later." },
});

const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many OTP requests. Try again later." },
});

router.use(authLimiter);

router.post("/register", authController.register);
router.post("/login", loginLimiter, authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authenticate(false), authController.logout);

router.post("/verify-email", otpLimiter, authController.verifyEmail);
router.post("/resend-otp", otpLimiter, authController.resendOtp);
router.post("/forgot-password", otpLimiter, authController.forgotPassword);
router.post("/reset-password", otpLimiter, authController.resetPassword);

router.post("/google", loginLimiter, authController.googleLogin);
router.post("/apple", loginLimiter, authController.appleLogin);

router.get("/me", authenticate(), authController.me);
router.patch("/profile", authenticate(), authController.updateProfile);
router.patch("/biometric", authenticate(), authController.setBiometric);

module.exports = router;

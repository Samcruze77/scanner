const authService = require("../services/authService");

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return password && password.length >= 8;
}

exports.register = async (req, res, next) => {
  try {
    const { fullName, email, password } = req.body;
    if (!validateEmail(email) || !validatePassword(password)) {
      return res.status(400).json({
        success: false,
        message: "Valid email and password (8+ characters) are required.",
      });
    }

    const data = await authService.register({ fullName, email, password });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!validateEmail(email) || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const data = await authService.login(email, password);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: "Refresh token required." });
    }

    const data = await authService.refresh(refreshToken);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    await authService.logout(req.body.refreshToken);
    if (req.user?.id) await authService.logoutAll(req.user.id);
    res.json({ success: true, message: "Logged out successfully." });
  } catch (error) {
    next(error);
  }
};

exports.me = async (req, res, next) => {
  try {
    const user = await authService.getUserById(req.user.id);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const user = await authService.updateProfile(req.user.id, { fullName: req.body.fullName });
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

exports.googleLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, message: "Google ID token is required." });
    }
    const data = await authService.loginWithGoogle(idToken);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.appleLogin = async (req, res, next) => {
  try {
    const { identityToken, fullName } = req.body;
    if (!identityToken) {
      return res.status(400).json({ success: false, message: "Apple identity token is required." });
    }
    const data = await authService.loginWithApple(identityToken, fullName);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

exports.setBiometric = async (req, res, next) => {
  try {
    const user = await authService.setBiometricEnabled(req.user.id, !!req.body.enabled);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ success: false, message: "Email and OTP code are required." });
    }

    const user = await authService.verifyEmail(email, code);
    res.json({ success: true, data: user, message: "Email verified successfully." });
  } catch (error) {
    next(error);
  }
};

exports.resendOtp = async (req, res, next) => {
  try {
    const { email, purpose } = req.body;
    if (!email || !purpose) {
      return res.status(400).json({ success: false, message: "Email and purpose are required." });
    }

    const otp = await authService.resendOtp(email, purpose);
    res.json({ success: true, message: "OTP sent.", data: otp });
  } catch (error) {
    next(error);
  }
};

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!validateEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required." });
    }

    const result = await authService.requestPasswordReset(email);
    res.json({ success: true, message: result.message, data: result.otp });
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!validateEmail(email) || !code || !validatePassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP code, and new password (8+ chars) are required.",
      });
    }

    const user = await authService.resetPassword(email, code, newPassword);
    res.json({ success: true, data: user, message: "Password reset successfully." });
  } catch (error) {
    next(error);
  }
};

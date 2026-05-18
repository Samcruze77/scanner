export function validateEmail(email) {
  if (!email?.trim()) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
  return null;
}

export function validatePassword(password) {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

export function validateFullName(name) {
  if (!name?.trim()) return "Full name is required.";
  if (name.trim().length < 2) return "Full name must be at least 2 characters.";
  return null;
}

export function validateOtp(code) {
  if (!code) return "OTP code is required.";
  if (!/^\d{6}$/.test(code)) return "OTP must be a 6-digit code.";
  return null;
}

export function validateConfirmPassword(password, confirm) {
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

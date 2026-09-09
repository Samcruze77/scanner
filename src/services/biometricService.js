import { Platform } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { getRefreshToken, getItem, setItem } from "./secureStorage";

const BIOMETRIC_ENABLED_KEY = "biometric_unlock_enabled";

export async function isBiometricHardwareAvailable() {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return compatible && enrolled;
}

export async function getBiometricTypes() {
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  return types;
}

export async function isBiometricUnlockEnabled() {
  const value = await getItem(BIOMETRIC_ENABLED_KEY);
  return value === "true";
}

export async function setBiometricUnlockEnabled(enabled) {
  await setItem(BIOMETRIC_ENABLED_KEY, enabled ? "true" : null);
}

export async function authenticateWithBiometrics(promptMessage = "Unlock Document Scanner") {
  const available = await isBiometricHardwareAvailable();
  if (!available) {
    const error = new Error("Biometrics not available on this device.");
    error.code = "BIOMETRIC_UNAVAILABLE";
    throw error;
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: "Cancel",
    disableDeviceFallback: false,
    fallbackLabel: "Use passcode",
  });

  if (!result.success) {
    const error = new Error(result.error === "user_cancel" ? "Authentication cancelled." : "Biometric authentication failed.");
    error.code = result.error;
    throw error;
  }

  return true;
}

export async function shouldPromptBiometricUnlock() {
  if (Platform.OS === "web") return false;
  const enabled = await isBiometricUnlockEnabled();
  const refreshToken = await getRefreshToken();
  return enabled && !!refreshToken;
}

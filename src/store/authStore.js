import { create } from "zustand";
import * as authApi from "../services/authApi";
import { clearTokens } from "../services/secureStorage";
import {
  authenticateWithBiometrics,
  isBiometricHardwareAvailable,
  setBiometricUnlockEnabled,
  shouldPromptBiometricUnlock,
} from "../services/biometricService";

export const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  pendingEmail: null,
  pendingOtpPurpose: null,
  needsBiometricUnlock: false,

  bootstrap: async () => {
    set({ isLoading: true, error: null });
    try {
      const needsBio = await shouldPromptBiometricUnlock();
      if (needsBio) {
        set({ needsBiometricUnlock: true, isLoading: false });
        return;
      }

      const session = await authApi.restoreSession();
      if (session?.user) {
        if (!session.user.emailVerified) {
          set({
            user: session.user,
            isAuthenticated: false,
            pendingEmail: session.user.email,
            pendingOtpPurpose: "email_verify",
            isLoading: false,
          });
        } else {
          set({ user: session.user, isAuthenticated: true, isLoading: false });
        }
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch {
      await clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await authApi.login(email, password);
      if (!data.user.emailVerified) {
        set({
          pendingEmail: data.user.email,
          pendingOtpPurpose: "email_verify",
          isLoading: false,
        });
        return { needsVerification: true, user: data.user };
      }
      set({ user: data.user, isAuthenticated: true, isLoading: false });
      return { needsVerification: false, user: data.user };
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  register: async (fullName, email, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await authApi.register(fullName, email, password);
      set({
        pendingEmail: email,
        pendingOtpPurpose: "email_verify",
        user: data.user,
        isAuthenticated: false,
        isLoading: false,
      });
      return data;
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  verifyOtp: async (email, code, purpose) => {
    set({ isLoading: true, error: null });
    try {
      const user = await authApi.verifyEmail(email, code);
      set({
        user,
        isAuthenticated: true,
        pendingEmail: null,
        pendingOtpPurpose: null,
        isLoading: false,
      });
      return user;
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  resendOtp: async (email, purpose) => {
    set({ error: null });
    return authApi.resendOtp(email, purpose);
  },

  forgotPassword: async (email) => {
    set({ isLoading: true, error: null });
    try {
      await authApi.forgotPassword(email);
      set({ pendingEmail: email, pendingOtpPurpose: "password_reset", isLoading: false });
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  resetPassword: async (email, code, newPassword) => {
    set({ isLoading: true, error: null });
    try {
      await authApi.resetPassword(email, code, newPassword);
      set({ pendingEmail: null, pendingOtpPurpose: null, isLoading: false });
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  refreshProfile: async () => {
    const user = await authApi.getMe();
    set({ user: user.data, isAuthenticated: true });
    return user.data;
  },

  updateProfile: async (fullName) => {
    set({ isLoading: true, error: null });
    try {
      const result = await authApi.updateProfile(fullName);
      set({ user: result.data, isLoading: false });
      return result.data;
    } catch (error) {
      set({ error: error.message, isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    await authApi.logout();
    await setBiometricUnlockEnabled(false);
    set({
      user: null,
      isAuthenticated: false,
      pendingEmail: null,
      pendingOtpPurpose: null,
      needsBiometricUnlock: false,
      error: null,
    });
  },

  completeBiometricUnlock: async () => {
    const session = await authApi.restoreSession();
    if (!session?.user) throw new Error("Session expired. Please sign in again.");
    set({
      user: session.user,
      isAuthenticated: true,
      needsBiometricUnlock: false,
    });
    return session.user;
  },

  skipBiometricUnlock: async () => {
    await setBiometricUnlockEnabled(false);
    set({ needsBiometricUnlock: false, isLoading: true });
    try {
      const session = await authApi.restoreSession();
      if (session?.user?.emailVerified) {
        set({ user: session.user, isAuthenticated: true, isLoading: false });
      } else if (session?.user) {
        set({
          user: session.user,
          isAuthenticated: false,
          pendingEmail: session.user.email,
          pendingOtpPurpose: "email_verify",
          isLoading: false,
        });
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch {
      await clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  loginWithSocial: async (data) => {
    set({
      user: data.user,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    return data;
  },

  enableBiometricUnlock: async () => {
    const available = await isBiometricHardwareAvailable();
    if (!available) throw new Error("Biometrics not available or not enrolled.");

    await authenticateWithBiometrics("Confirm to enable biometric unlock");
    await setBiometricUnlockEnabled(true);
    try {
      await authApi.setBiometricPreference(true);
    } catch {
      /* local preference still works */
    }
    const user = get().user;
    if (user) set({ user: { ...user, biometricEnabled: true } });
    return true;
  },

  disableBiometricUnlock: async () => {
    await setBiometricUnlockEnabled(false);
    try {
      await authApi.setBiometricPreference(false);
    } catch {
      /* ignore */
    }
    const user = get().user;
    if (user) set({ user: { ...user, biometricEnabled: false } });
  },

  clearError: () => set({ error: null }),
}));

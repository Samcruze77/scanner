"use client";

// Client-side session state for UI purposes only (showing the account menu
// vs. sign-in controls, gating "Save"/"History" prompts). This is NOT an
// authorization boundary -- Storage/table access is enforced by Supabase
// RLS using the user's own session, and utils/supabase/claims.ts's
// getVerifiedClaims() remains the source of truth for any server-side check.
//
// Also owns the sign-in/sign-up modal's open/closed state so any component
// (header, "Save" button, history page) can trigger it without prop drilling.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";

export type AuthModalMode = "signup" | "login" | "forgot";

// Set (in this tab only) when a password-recovery link has been opened, so the
// reset page still works after a reload. It holds no secret: just "yes" and when.
const RECOVERY_KEY = "ds_password_recovery";
const RECOVERY_MAX_AGE_MS = 60 * 60 * 1000; // reset links expire after about an hour

function readRecoveryMarker(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(RECOVERY_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < RECOVERY_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function writeRecoveryMarker(on: boolean) {
  try {
    if (on) window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
    else window.sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    // Private mode etc.: the reset page still works for this page load.
  }
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  // True while the signed-in session came from a password-recovery link and the
  // new password hasn't been set yet.
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
  authModalOpen: boolean;
  authModalMode: AuthModalMode;
  openAuthModal: (mode?: AuthModalMode) => void;
  closeAuthModal: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  passwordRecovery: false,
  clearPasswordRecovery: () => {},
  authModalOpen: false,
  authModalMode: "login",
  openAuthModal: () => {},
  closeAuthModal: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>("login");

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      // A reload of the reset page: the recovery session is still there.
      if (data.session && readRecoveryMarker()) setPasswordRecovery(true);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === "PASSWORD_RECOVERY") {
        writeRecoveryMarker(true);
        setPasswordRecovery(true);
      } else if (event === "SIGNED_OUT") {
        writeRecoveryMarker(false);
        setPasswordRecovery(false);
      }
      setLoading(false);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const openAuthModal = useCallback((mode: AuthModalMode = "login") => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => setAuthModalOpen(false), []);

  const clearPasswordRecovery = useCallback(() => {
    writeRecoveryMarker(false);
    setPasswordRecovery(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        passwordRecovery,
        clearPasswordRecovery,
        authModalOpen,
        authModalMode,
        openAuthModal,
        closeAuthModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

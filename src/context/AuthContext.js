import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getMe, getToken, login, register, setToken } from "../services/authApi";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (token) {
          const me = await getMe();
          setUser(me.data);
        }
      } catch {
        await setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isPro: user?.plan === "pro",
      signIn: async (email, password) => {
        const data = await login(email, password);
        setUser(data.user);
        return data;
      },
      signUp: async (email, password) => {
        const data = await register(email, password);
        setUser(data.user);
        return data;
      },
      signOut: async () => {
        await setToken(null);
        setUser(null);
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

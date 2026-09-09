import { getApiBaseUrl } from "./api";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "./secureStorage";

let refreshPromise = null;

async function apiFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${getApiBaseUrl()}${path}`;
  try {
    return await fetch(url, options);
  } catch {
    const error = new Error(
      `Cannot reach the API at ${getApiBaseUrl()}. Start the backend: cd backend && docker compose up -d`
    );
    error.code = "NETWORK_ERROR";
    throw error;
  }
}

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || "Request failed");
    error.code = body.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) throw new Error("No refresh token");

    const response = await apiFetch("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    const body = await parseResponse(response);
    await setTokens({
      accessToken: body.data.accessToken,
      refreshToken: body.data.refreshToken,
    });
    return body.data;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function authFetch(path, options = {}, retry = true) {
  const accessToken = await getAccessToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };

  const response = await apiFetch(path, { ...options, headers });

  if (response.status === 401 && retry && (await getRefreshToken())) {
    try {
      await refreshAccessToken();
      return authFetch(path, options, false);
    } catch {
      await clearTokens();
      throw new Error("Session expired. Please log in again.");
    }
  }

  return parseResponse(response);
}

export async function restoreSession() {
  const accessToken = await getAccessToken();
  const refreshToken = await getRefreshToken();
  if (!accessToken && !refreshToken) return null;

  try {
    if (accessToken) {
      const me = await authFetch("/auth/me");
      return { user: me.data };
    }
  } catch {
    /* try refresh */
  }

  if (refreshToken) {
    const data = await refreshAccessToken();
    return { user: data.user };
  }

  return null;
}

export async function login(email, password) {
  const response = await apiFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseResponse(response);
  await setTokens({
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
  });
  return body.data;
}

export async function register(fullName, email, password) {
  const response = await apiFetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName, email, password }),
  });
  const body = await parseResponse(response);
  await setTokens({
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
  });
  return body.data;
}

export async function logout() {
  const refreshToken = await getRefreshToken();
  try {
    await authFetch("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    /* ignore */
  }
  await clearTokens();
}

export async function getMe() {
  return authFetch("/auth/me");
}

export async function updateProfile(fullName) {
  return authFetch("/auth/profile", {
    method: "PATCH",
    body: JSON.stringify({ fullName }),
  });
}

export async function verifyEmail(email, code) {
  const body = await authFetch("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
  return body.data;
}

export async function resendOtp(email, purpose) {
  return authFetch("/auth/resend-otp", {
    method: "POST",
    body: JSON.stringify({ email, purpose }),
  });
}

export async function forgotPassword(email) {
  const response = await fetch(`${getApiBaseUrl()}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return parseResponse(response);
}

export async function setBiometricPreference(enabled) {
  return authFetch("/auth/biometric", {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function loginWithGoogle(idToken) {
  const response = await apiFetch("/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const body = await parseResponse(response);
  await setTokens({
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
  });
  return body.data;
}

export async function loginWithApple(identityToken, fullName) {
  const response = await apiFetch("/auth/apple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identityToken, fullName }),
  });
  const body = await parseResponse(response);
  await setTokens({
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
  });
  return body.data;
}

export async function resetPassword(email, code, newPassword) {
  const response = await apiFetch("/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, newPassword }),
  });
  return parseResponse(response);
}

// Legacy compatibility
export async function getToken() {
  return getAccessToken();
}

export async function setToken() {
  /* use setTokens instead */
}

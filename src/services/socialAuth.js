import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { getApiBaseUrl } from "./api";
import { setTokens } from "./secureStorage";

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const GOOGLE_ANDROID_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
const GOOGLE_EXPO_ID = process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID;
const GOOGLE_WEB_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export function useGoogleAuthRequest() {
  return Google.useAuthRequest({
    expoClientId: GOOGLE_EXPO_ID,
    iosClientId: GOOGLE_IOS_ID,
    androidClientId: GOOGLE_ANDROID_ID,
    webClientId: GOOGLE_WEB_ID,
  });
}

export function isGoogleConfigured() {
  if (Platform.OS === "web") return !!GOOGLE_WEB_ID;
  if (Platform.OS === "ios") return !!(GOOGLE_IOS_ID || GOOGLE_EXPO_ID);
  if (Platform.OS === "android") return !!(GOOGLE_ANDROID_ID || GOOGLE_EXPO_ID);
  return !!(GOOGLE_EXPO_ID || GOOGLE_IOS_ID || GOOGLE_ANDROID_ID || GOOGLE_WEB_ID);
}

export async function signInWithGoogleIdToken(idToken) {
  const response = await fetch(`${getApiBaseUrl()}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Google sign-in failed");

  await setTokens({
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
  });
  return body.data;
}

export async function signInWithApple() {
  if (Platform.OS !== "ios") {
    throw new Error("Apple Sign-In is only available on iOS.");
  }

  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new Error("Apple Sign-In is not available on this device.");
  }

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
    .filter(Boolean)
    .join(" ");

  const response = await fetch(`${getApiBaseUrl()}/auth/apple`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identityToken: credential.identityToken,
      fullName,
    }),
  });

  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Apple sign-in failed");

  await setTokens({
    accessToken: body.data.accessToken,
    refreshToken: body.data.refreshToken,
  });
  return body.data;
}

export function isAppleSignInAvailable() {
  return Platform.OS === "ios";
}

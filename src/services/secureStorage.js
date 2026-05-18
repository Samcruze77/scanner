import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const ACCESS_KEY = "auth_access_token";
const REFRESH_KEY = "auth_refresh_token";

async function setItem(key, value) {
  if (Platform.OS === "web") {
    if (value) await AsyncStorage.setItem(key, value);
    else await AsyncStorage.removeItem(key);
    return;
  }
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

async function getItem(key) {
  if (Platform.OS === "web") return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function getAccessToken() {
  return getItem(ACCESS_KEY);
}

export async function getRefreshToken() {
  return getItem(REFRESH_KEY);
}

export async function setTokens({ accessToken, refreshToken }) {
  await setItem(ACCESS_KEY, accessToken || null);
  await setItem(REFRESH_KEY, refreshToken || null);
}

export async function clearTokens() {
  await setItem(ACCESS_KEY, null);
  await setItem(REFRESH_KEY, null);
}

export { getItem, setItem };

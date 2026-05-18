import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "./api";
import { getToken } from "./authApi";

const SETTINGS_KEY = "@notification_settings";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermissions() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function getNotificationSettings() {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  return raw
    ? JSON.parse(raw)
    : {
        conversionComplete: true,
        ocrComplete: true,
        jobFailed: true,
        pushEnabled: true,
      };
}

export async function saveNotificationSettings(settings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  const token = await getToken();
  if (token) {
    await fetch(`${getApiBaseUrl()}/notifications/settings`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled: settings.pushEnabled }),
    }).catch(() => {});
  }
  return settings;
}

export async function registerForPushNotifications() {
  if (!(await requestNotificationPermissions())) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.easConfig?.projectId ||
    Constants.expoConfig?.extra?.projectId;

  const pushToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const token = await getToken();

  if (token) {
    await fetch(`${getApiBaseUrl()}/notifications/push-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        token: pushToken.data,
        platform: Platform.OS,
      }),
    }).catch(() => {});
  }

  return pushToken.data;
}

export function addNotificationResponseListener(handler) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data || {};
    handler(data);
  });
}

async function shouldNotify(kind) {
  const settings = await getNotificationSettings();
  return settings[kind] !== false;
}

export async function notifyConversionComplete(title, body, data = {}) {
  if (!(await shouldNotify("conversionComplete"))) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: null,
  });
}

export async function notifyOcrComplete(title, body, data = {}) {
  if (!(await shouldNotify("ocrComplete"))) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: null,
  });
}

export async function notifyConversionFailed(title, body, data = {}) {
  if (!(await shouldNotify("jobFailed"))) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: null,
  });
}

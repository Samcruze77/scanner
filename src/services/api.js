import { Platform } from "react-native";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000";

export function getApiBaseUrl() {
  return API_BASE_URL.replace(/\/$/, "");
}

export async function checkApiHealth() {
  const response = await fetch(`${getApiBaseUrl()}/health`);
  if (!response.ok) throw new Error("API health check failed");
  return response.json();
}

export async function uploadFile(uri, uploadUrl, token) {
  // Use the safer version to convert uri to blob
  const response = await fetch(uri);
  const blob = await response.blob();

  const headers = {
    "Content-Type": "application/octet-stream",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers,
    body: blob,
  });

  if (!uploadResponse.ok) {
    const errorData = await uploadResponse.json().catch(() => ({}));
    throw new Error(errorData.message || "Upload failed");
  }

  return await uploadResponse.json();
}

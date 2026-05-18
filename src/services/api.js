const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000";

export function getApiBaseUrl() {
  return API_BASE_URL.replace(/\/$/, "");
}

export async function checkApiHealth() {
  const response = await fetch(`${getApiBaseUrl()}/health`);
  if (!response.ok) throw new Error("API health check failed");
  return response.json();
}

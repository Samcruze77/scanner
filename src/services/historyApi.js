import { authFetch } from "./authApi";

export async function fetchServerHistory() {
  const result = await authFetch("/history");
  return result.data || [];
}

export async function redownloadHistoryItem(id) {
  const result = await authFetch(`/history/${id}/download`);
  return result.data?.downloadUrl;
}

export async function deleteHistoryItem(id) {
  return authFetch(`/history/${id}`, { method: "DELETE" });
}

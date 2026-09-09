import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { getApiBaseUrl } from "./api";
import { getToken } from "./authApi";
import { addConversionHistory } from "./historyStorage";
import { subscribeToJob } from "./jobSocketService";

export function validateFileSize(sizeBytes, maxMb = 25) {
  if (!sizeBytes) return { valid: true };
  const maxBytes = maxMb * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return { valid: false, message: `File exceeds ${maxMb}MB limit.` };
  }
  return { valid: true };
}

async function pollJob(jobId, onProgress, onJobUpdate) {
  const token = await getToken();
  const maxAttempts = 90;

  for (let i = 0; i < maxAttempts; i += 1) {
    const response = await fetch(`${getApiBaseUrl()}/jobs/${jobId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || "Failed to check job status");

    const { state, status, progress, result, error, retryCount, processingTimeMs } = body.data;
    onJobUpdate?.({ jobId, state, status: status || state, progress, result, error, retryCount, processingTimeMs });
    if (typeof progress === "number") onProgress?.(progress / 100);

    if (state === "completed") return result;
    if (state === "failed") throw new Error(error || "Conversion failed");

    await new Promise((r) => setTimeout(r, 2000));
    onProgress?.(Math.min(0.85, 0.2 + i * 0.02));
  }

  throw new Error("Conversion timed out.");
}

async function submitWithFetch({ endpoint, token, tool, files, pageRanges, language, exportFormat, onUploadProgress }) {
  const formData = new FormData();
  if (pageRanges) formData.append("pages", pageRanges);
  if (language) formData.append("language", language);
  if (exportFormat) formData.append("exportFormat", exportFormat);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    // Use the safer version to convert uri to blob
    const response = await fetch(file.uri);
    const blob = await response.blob();
    
    formData.append(tool.fieldName, blob, file.name || `file_${i}`);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  const body = await response.json();
  if (response.ok) return body;
  throw new Error(body.message || "Upload failed");
}

async function submitWithXhr({ endpoint, token, tool, files, pageRanges, language, exportFormat, onUploadProgress }) {
  const formData = new FormData();

  if (pageRanges) formData.append("pages", pageRanges);
  if (language) formData.append("language", language);
  if (exportFormat) formData.append("exportFormat", exportFormat);

  files.forEach((file, index) => {
    formData.append(tool.fieldName, {
      uri: file.uri,
      name: file.name || `file_${index}`,
      type: file.mimeType || "application/octet-stream",
    });
  });

  try {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", endpoint);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onUploadProgress?.(event.loaded / event.total * 0.4);
      };

      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || "{}");
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(body.message || "Upload failed"));
        } catch (e) {
          reject(e);
        }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(formData);
    });
  } catch (error) {
    console.warn("XHR upload failed, trying safer fetch version:", error);
    return submitWithFetch({ endpoint, token, tool, files, pageRanges, language, exportFormat, onUploadProgress });
  }
}

async function submitWithBackgroundUpload({ endpoint, token, tool, files, pageRanges, language, exportFormat, onUploadProgress }) {
  if (Platform.OS === "web" || files.length !== 1 || !FileSystem.createUploadTask) {
    return submitWithXhr({ endpoint, token, tool, files, pageRanges, language, exportFormat, onUploadProgress });
  }

  const parameters = {};
  if (pageRanges) parameters.pages = pageRanges;
  if (language) parameters.language = language;
  if (exportFormat) parameters.exportFormat = exportFormat;

  const task = FileSystem.createUploadTask(
    endpoint,
    files[0].uri,
    {
      fieldName: tool.fieldName,
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      parameters,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    },
    ({ totalBytesSent, totalBytesExpectedToSend }) => {
      if (totalBytesExpectedToSend) {
        onUploadProgress?.((totalBytesSent / totalBytesExpectedToSend) * 0.4);
      }
    }
  );

  const result = await task.uploadAsync();
  const body = JSON.parse(result.body || "{}");
  if (result.status >= 200 && result.status < 300) return body;
  throw new Error(body.message || "Upload failed");
}

export async function fetchJob(jobId) {
  const token = await getToken();
  const response = await fetch(`${getApiBaseUrl()}/jobs/${jobId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Failed to check job status");
  return body.data;
}

export async function uploadAndConvertWithJob({
  tool,
  files,
  pageRanges,
  language,
  exportFormat,
  onUploadProgress,
  onJobUpdate,
  useBackgroundUpload = true,
}) {
  const endpoint = `${getApiBaseUrl()}${tool.endpoint}`;
  const token = await getToken();

  const submitResponse = useBackgroundUpload
    ? await submitWithBackgroundUpload({ endpoint, token, tool, files, pageRanges, language, exportFormat, onUploadProgress })
    : await submitWithXhr({ endpoint, token, tool, files, pageRanges, language, exportFormat, onUploadProgress });

  onUploadProgress?.(0.45);
  const jobId = submitResponse.data?.jobId;
  if (!jobId) throw new Error("No job ID returned");

  let unsubscribe;
  try {
    unsubscribe = await subscribeToJob(jobId, (update) => {
      onJobUpdate?.(update);
      if (typeof update.progress === "number") onUploadProgress?.(update.progress / 100);
    });
  } catch {
    unsubscribe = null;
  }

  let result;
  try {
    result = await pollJob(jobId, onUploadProgress, onJobUpdate);
  } finally {
    unsubscribe?.();
  }
  onUploadProgress?.(1);

  await addConversionHistory({
    toolId: tool.id,
    toolTitle: tool.title,
    fileName: result.fileName,
    downloadUrl: result.downloadUrl,
    mimeType: result.mimeType,
    jobId,
    status: "completed",
  });

  return { ...submitResponse, result, jobId };
}

function getDownloadFileName(downloadUrl, fileName) {
  if (fileName) return fileName;

  const urlFileName = downloadUrl.split("?")[0].split("/").pop();
  return urlFileName || `document-${Date.now()}`;
}

export async function downloadConvertedFile(downloadUrl, fileName) {
  const target = `${FileSystem.documentDirectory}${getDownloadFileName(downloadUrl, fileName)}`;
  const result = await FileSystem.downloadAsync(downloadUrl, target);
  return result.uri;
}

export async function fetchOcrLanguages() {
  const response = await fetch(`${getApiBaseUrl()}/ocr/languages`);
  const body = await response.json();
  return body.data || [];
}

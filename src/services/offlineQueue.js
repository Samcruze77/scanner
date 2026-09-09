import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { getApiBaseUrl } from "./api";
import { uploadAndConvertWithJob } from "./conversionService";

async function isOnline() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

const QUEUE_KEY = "@offline_conversion_queue";

export async function getQueue() {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveQueue(items) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export async function enqueueOfflineJob(job) {
  const queue = await getQueue();
  const id = `${Date.now()}`;
  const files = await Promise.all(
    (job.files || []).map(async (file, index) => {
      const name = file.name || `upload_${index}`;
      const target = `${FileSystem.documentDirectory}pending_${id}_${name}`;
      try {
        await FileSystem.copyAsync({ from: file.uri, to: target });
        return { ...file, uri: target };
      } catch {
        return file;
      }
    })
  );
  queue.push({ ...job, files, id, status: "queued", createdAt: new Date().toISOString(), retryCount: 0 });
  await saveQueue(queue);
  return queue;
}

export async function processOfflineQueue(onProgress) {
  if (!(await isOnline())) return { processed: 0 };

  const queue = await getQueue();
  let processed = 0;

  for (const item of queue) {
    if (item.status === "completed") continue;
    try {
      onProgress?.(item, "processing");
      item.retryCount = (item.retryCount || 0) + 1;
      const result = await uploadAndConvertWithJob(item);
      item.status = "completed";
      item.result = result;
      processed += 1;
      onProgress?.(item, "completed");
    } catch (error) {
      item.status = "failed";
      item.error = error.message;
      onProgress?.(item, "failed");
    }
  }

  const remaining = queue.filter((q) => q.status !== "completed");
  await saveQueue(remaining);
  return { processed, remaining: remaining.length };
}

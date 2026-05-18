import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { AppState } from "react-native";
import { processOfflineQueue } from "./offlineQueue";

const CONVERSION_BACKGROUND_TASK = "document-converter-background-queue";
let appStateSubscription;

TaskManager.defineTask(CONVERSION_BACKGROUND_TASK, async () => {
  try {
    const result = await processOfflineQueue();
    return result.processed > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundConversionTasks() {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    return false;
  }

  const registered = await TaskManager.isTaskRegisteredAsync(CONVERSION_BACKGROUND_TASK);
  if (!registered) {
    await BackgroundFetch.registerTaskAsync(CONVERSION_BACKGROUND_TASK, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }

  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") processOfflineQueue().catch(() => {});
    });
  }

  return true;
}

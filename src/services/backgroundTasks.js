import { Platform } from "react-native";
import { AppState } from "react-native";

const CONVERSION_BACKGROUND_TASK = "document-converter-background-queue";
let appStateSubscription;
let taskDefined = false;

export async function registerBackgroundConversionTasks() {
  if (Platform.OS === "web") return false;

  const [{ default: BackgroundFetch }, { default: TaskManager }, { processOfflineQueue }] = await Promise.all([
    import("expo-background-fetch"),
    import("expo-task-manager"),
    import("./offlineQueue"),
  ]);

  if (!taskDefined) {
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
    taskDefined = true;
  }

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

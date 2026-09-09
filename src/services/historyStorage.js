import AsyncStorage from "@react-native-async-storage/async-storage";

const HISTORY_KEY = "@converter_history_v1";
const MAX_ITEMS = 50;

export async function getConversionHistory() {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addConversionHistory(entry) {
  const current = await getConversionHistory();
  const next = [{ ...entry, id: `${Date.now()}`, createdAt: new Date().toISOString() }, ...current].slice(
    0,
    MAX_ITEMS
  );
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export async function clearConversionHistory() {
  await AsyncStorage.removeItem(HISTORY_KEY);
}

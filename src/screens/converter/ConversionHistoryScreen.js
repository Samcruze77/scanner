import React, { useCallback, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { clearConversionHistory, getConversionHistory } from "../../services/historyStorage";
import { deleteHistoryItem, fetchServerHistory, redownloadHistoryItem } from "../../services/historyApi";
import { useAuthStore } from "../../store/authStore";
import { useTheme } from "../../theme/ThemeContext";

function formatSize(bytes) {
  if (!bytes) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ConversionHistoryScreen({ navigation }) {
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadHistory = async () => {
    const local = await getConversionHistory();
    if (user) {
      try {
        const server = await fetchServerHistory();
        const merged = [...server, ...local].reduce((acc, item) => {
          const key = item.id || item.jobId || item.createdAt;
          if (!acc.has(key)) acc.set(key, item);
          return acc;
        }, new Map());
        setHistory(Array.from(merged.values()));
        return;
      } catch {
        /* fallback local */
      }
    }
    setHistory(local);
  };

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [user])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  };

  const onDelete = (item) => {
    Alert.alert("Delete", "Remove this conversion from history?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (item.id && user) {
            try {
              await deleteHistoryItem(item.id);
            } catch {
              /* local only id */
            }
          }
          setHistory((prev) => prev.filter((h) => (h.id || h.createdAt) !== (item.id || item.createdAt)));
        },
      },
    ]);
  };

  const onRedownload = async (item) => {
    try {
      let url = item.download_url || item.downloadUrl;
      if (item.id && user) {
        url = await redownloadHistoryItem(item.id);
      }
      if (!url) throw new Error("Download URL unavailable");
      navigation.navigate("FilePreview", {
        toolTitle: item.conversion_type || item.toolTitle,
        fileName: item.converted_filename || item.fileName,
        downloadUrl: url,
        mimeType: item.mimeType,
      });
    } catch (error) {
      Alert.alert("Download failed", error.message);
    }
  };

  const onClear = () => {
    Alert.alert("Clear history", "Remove all local conversion history?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          await clearConversionHistory();
          await loadHistory();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: colors.text }]}>Conversion History</Text>
        {history.length > 0 && (
          <TouchableOpacity onPress={onClear}>
            <Text style={{ color: colors.error, fontWeight: "700" }}>Clear Local</Text>
          </TouchableOpacity>
        )}
      </View>

      {!history.length ? (
        <Text style={{ color: colors.textMuted, marginTop: 20 }}>No conversions yet.</Text>
      ) : (
        history.map((item) => {
          const name = item.converted_filename || item.fileName || item.original_filename;
          const type = item.conversion_type || item.toolTitle;
          const status = item.status || "completed";
          const date = item.created_at || item.createdAt;
          const size = item.file_size_bytes || item.fileSize;

          return (
            <View key={item.id || item.createdAt} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]}>{type}</Text>
              <Text style={[styles.meta, { color: colors.textMuted }]}>{name}</Text>
              <Text style={[styles.meta, { color: colors.textMuted }]}>
                {new Date(date).toLocaleString()} · {formatSize(size)} · {status}
              </Text>

              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => onRedownload(item)}>
                  <Ionicons name="download-outline" size={18} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontWeight: "600" }}>Re-download</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => onDelete(item)}>
                  <Ionicons name="trash-outline" size={18} color={colors.error} />
                  <Text style={{ color: colors.error, fontWeight: "600" }}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 30 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: 24, fontWeight: "800" },
  card: { marginTop: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  title: { fontWeight: "700", fontSize: 15 },
  meta: { marginTop: 6, fontSize: 12 },
  actions: { flexDirection: "row", gap: 16, marginTop: 12 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
});

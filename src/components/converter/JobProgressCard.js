import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeContext";
import ProgressBar from "./ProgressBar";

const STATUS_META = {
  queued: { icon: "time-outline", label: "Queued" },
  processing: { icon: "sync-outline", label: "Processing" },
  completed: { icon: "checkmark-circle-outline", label: "Completed" },
  failed: { icon: "alert-circle-outline", label: "Failed" },
};

export default function JobProgressCard({ job, progress = 0, label }) {
  const { colors } = useTheme();
  const status = job?.status || job?.state || "queued";
  const meta = STATUS_META[status] || STATUS_META.queued;
  const pct = typeof job?.progress === "number" ? job.progress / 100 : progress;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.row}>
        <View style={styles.statusRow}>
          <Ionicons name={meta.icon} size={20} color={status === "failed" ? colors.error : colors.primary} />
          <Text style={[styles.status, { color: colors.text }]}>{meta.label}</Text>
        </View>
        {job?.retryCount ? (
          <Text style={[styles.retry, { color: colors.textMuted }]}>Retry {job.retryCount}</Text>
        ) : null}
      </View>
      <ProgressBar progress={pct} label={label || meta.label} />
      <Text style={[styles.hint, { color: colors.textMuted }]}>
        You can leave the app while this continues in the background.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16, borderWidth: 1, borderRadius: 8, padding: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  status: { fontWeight: "800", fontSize: 15 },
  retry: { fontSize: 12, fontWeight: "700" },
  hint: { marginTop: 8, fontSize: 12, lineHeight: 17 },
});

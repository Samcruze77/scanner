import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeContext";

export default function FilePickerZone({ files = [], onPick, onClear, multiple = false, disabled = false }) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      disabled={disabled}
      onPress={onPick}
      style={[
        styles.zone,
        {
          backgroundColor: colors.dropZone,
          borderColor: colors.dropZoneBorder,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <Ionicons name="cloud-upload-outline" size={34} color={colors.primary} />
      <Text style={[styles.title, { color: colors.text }]}>
        {multiple ? "Tap to pick files" : "Tap to pick a file"}
      </Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Drag-and-drop style picker for mobile (tap zone)
      </Text>

      {files.length > 0 && (
        <View style={[styles.fileList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {files.map((file) => (
            <Text key={file.uri} style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>
              {file.name}
            </Text>
          ))}
          <TouchableOpacity onPress={onClear} style={styles.clearBtn}>
            <Text style={{ color: colors.error, fontWeight: "700" }}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  zone: {
    marginTop: 18,
    borderWidth: 2,
    borderStyle: "dashed",
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
  },
  title: { marginTop: 10, fontSize: 17, fontWeight: "700" },
  subtitle: { marginTop: 6, fontSize: 13, textAlign: "center" },
  fileList: {
    marginTop: 14,
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  fileName: { fontSize: 13 },
  clearBtn: { marginTop: 6, alignSelf: "flex-end" },
});

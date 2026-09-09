import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Sharing from "expo-sharing";
import { Ionicons } from "@expo/vector-icons";
import { downloadConvertedFile, fetchJob } from "../../services/conversionService";
import { useTheme } from "../../theme/ThemeContext";

export default function FilePreviewScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { toolTitle, jobId } = route.params || {};
  const [jobResult, setJobResult] = useState(route.params || {});
  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileName = jobResult.fileName;
  const downloadUrl = jobResult.downloadUrl;
  const mimeType = jobResult.mimeType;

  useEffect(() => {
    if (!jobId || downloadUrl) return;
    fetchJob(jobId)
      .then((job) => {
        if (job.result) setJobResult((prev) => ({ ...prev, ...job.result }));
      })
      .catch(() => {});
  }, [downloadUrl, jobId]);

  const handleDownload = async () => {
    if (!downloadUrl) {
      Alert.alert("Still processing", "The conversion result is not ready yet.");
      return null;
    }
    try {
      setLoading(true);
      const uri = await downloadConvertedFile(downloadUrl, fileName);
      setLocalUri(uri);
      Alert.alert("Downloaded", "File saved locally and ready to share.");
      return uri;
    } catch (error) {
      Alert.alert("Download failed", error.message || "Unable to download file.");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("Sharing unavailable", "Sharing is not supported on this device.");
        return;
      }
      if (!localUri) {
        const downloadedUri = await handleDownload();
        if (!downloadedUri) return;
        await Sharing.shareAsync(downloadedUri);
        return;
      }
      await Sharing.shareAsync(localUri);
    } catch (error) {
      Alert.alert("Share failed", error.message || "Unable to share file.");
    }
  };

  const handleOpen = async () => {
    if (!downloadUrl) {
      Alert.alert("Still processing", "The conversion result is not ready yet.");
      return;
    }
    const canOpen = await Linking.canOpenURL(downloadUrl);
    if (!canOpen) {
      Alert.alert("Cannot open", "Unable to open preview URL.");
      return;
    }
    Linking.openURL(downloadUrl);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>Preview</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>{toolTitle}</Text>

      <View style={[styles.previewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="document-outline" size={48} color={colors.primary} />
        <Text style={[styles.fileName, { color: colors.text }]}>{fileName}</Text>
        <Text style={[styles.mime, { color: colors.textMuted }]}>{mimeType}</Text>
        <Text style={[styles.url, { color: colors.textMuted }]} numberOfLines={2}>
          {downloadUrl}
        </Text>
      </View>

      <TouchableOpacity style={[styles.btn, { backgroundColor: colors.primary }]} onPress={handleDownload} disabled={loading}>
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>Download</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btnOutline, { borderColor: colors.primary }]} onPress={handleShare}>
        <Text style={[styles.btnOutlineText, { color: colors.primary }]}>Share File</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btnOutline, { borderColor: colors.border }]} onPress={handleOpen}>
        <Text style={[styles.btnOutlineText, { color: colors.text }]}>Open in Browser</Text>
      </TouchableOpacity>

      {mimeType === "application/pdf" && (
        <TouchableOpacity
          style={[styles.btnOutline, { borderColor: colors.primary, marginTop: 12 }]}
          onPress={async () => {
            const uri = localUri || (await handleDownload());
            if (uri) {
              navigation.navigate("Signature", { fileUri: uri, fileName });
            }
          }}
        >
          <Text style={[styles.btnOutlineText, { color: colors.primary }]}>Sign Document</Text>
        </TouchableOpacity>
      )}

      {mimeType === "application/pdf" && (
        <TouchableOpacity
          style={[styles.btnOutline, { borderColor: colors.primary, marginTop: 12 }]}
          onPress={async () => {
            const uri = localUri || (await handleDownload());
            if (uri) {
              navigation.navigate("DocumentEditor", { fileUri: uri, fileName });
            }
          }}
        >
          <Text style={[styles.btnOutlineText, { color: colors.primary }]}>Edit Document</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: "800" },
  subtitle: { marginTop: 4, fontSize: 14 },
  previewCard: {
    marginTop: 20,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
  },
  fileName: { marginTop: 12, fontWeight: "700", fontSize: 16, textAlign: "center" },
  mime: { marginTop: 6, fontSize: 13 },
  url: { marginTop: 10, fontSize: 11, textAlign: "center" },
  btn: { marginTop: 20, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnText: { color: "#FFFFFF", fontWeight: "700" },
  btnOutline: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
  },
  btnOutlineText: { fontWeight: "700" },
});

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { getToolById, MAX_FILE_SIZE_MB } from "../../constants/conversions";
import FilePickerZone from "../../components/converter/FilePickerZone";
import JobProgressCard from "../../components/converter/JobProgressCard";
import StatusBanner from "../../components/converter/StatusBanner";
import { uploadAndConvertWithJob, validateFileSize } from "../../services/conversionService";
import { enqueueOfflineJob, processOfflineQueue } from "../../services/offlineQueue";
import { notifyConversionComplete, notifyConversionFailed, requestNotificationPermissions } from "../../services/notificationService";
import { useTheme } from "../../theme/ThemeContext";
import { useAuthStore } from "../../store/authStore";

export default function ConvertToolScreen({ navigation, route }) {
  const { colors } = useTheme();
  useAuthStore((s) => s.user);
  const tool = getToolById(route.params?.toolId);
  const [files, setFiles] = useState([]);
  const [pageRanges, setPageRanges] = useState("1-2");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobUpdate, setJobUpdate] = useState(null);
  const [converting, setConverting] = useState(false);
  const [status, setStatus] = useState({ type: "info", message: "" });
  const progressTimer = useRef(null);

  useEffect(() => {
    requestNotificationPermissions();
    processOfflineQueue();
    return () => clearInterval(progressTimer.current);
  }, []);

  if (!tool) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Tool not found.</Text>
      </View>
    );
  }

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: tool.accept,
      multiple: tool.multiple,
      copyToCacheDirectory: true,
    });

    if (result.canceled) return;

    const selected = result.assets || [];
    for (const file of selected) {
      const validation = validateFileSize(file.size, MAX_FILE_SIZE_MB);
      if (!validation.valid) {
        Alert.alert("File too large", validation.message);
        return;
      }
    }

    setFiles(
      selected.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      }))
    );
    setStatus({ type: "info", message: `${selected.length} file(s) selected.` });
  };

  const startConversion = async () => {
    if (!files.length) {
      Alert.alert("No file selected", "Please pick at least one file.");
      return;
    }

    if (tool.multiple && files.length < 2 && tool.id === "pdf-merge") {
      Alert.alert("Need more files", "Select at least 2 PDF files to merge.");
      return;
    }

    try {
      setConverting(true);
      setUploadProgress(0.05);
      setJobUpdate({ status: "queued", progress: 0 });
      setStatus({ type: "info", message: "Uploading file(s)..." });

      progressTimer.current = setInterval(() => {
        setUploadProgress((prev) => (prev < 0.85 ? prev + 0.08 : prev));
      }, 350);

      const response = await uploadAndConvertWithJob({
        tool,
        files,
        pageRanges: tool.requiresPages ? pageRanges : undefined,
        onUploadProgress: setUploadProgress,
        onJobUpdate: (update) => {
          setJobUpdate(update);
          if (update.status === "queued") setStatus({ type: "info", message: "Conversion queued." });
          if (update.status === "processing") setStatus({ type: "info", message: "Conversion processing..." });
        },
      });

      clearInterval(progressTimer.current);
      setUploadProgress(1);
      setStatus({ type: "success", message: "Conversion successful!" });
      await notifyConversionComplete("Conversion Done", `${tool.title} is ready.`, {
        type: "conversion_completed",
        jobId: response.jobId,
        result: response.result,
      });

      navigation.navigate("FilePreview", {
        toolTitle: tool.title,
        fileName: response.result?.fileName,
        downloadUrl: response.result?.downloadUrl,
        mimeType: response.result?.mimeType,
      });
    } catch (error) {
      clearInterval(progressTimer.current);
      if (error.message?.includes("Network")) {
        await enqueueOfflineJob({ tool, files, pageRanges: tool.requiresPages ? pageRanges : undefined });
        setStatus({ type: "info", message: "Offline: job queued and will retry when online." });
      } else {
        setJobUpdate((prev) => ({ ...(prev || {}), status: "failed", progress: 100, error: error.message }));
        setStatus({ type: "error", message: error.message || "Conversion failed." });
        await notifyConversionFailed("Conversion Failed", error.message, {
          type: "job_failed",
          jobId: jobUpdate?.jobId,
        });
      }
    } finally {
      setConverting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>{tool.title}</Text>
      <Text style={[styles.desc, { color: colors.textMuted }]}>{tool.description}</Text>

      <FilePickerZone
        files={files}
        multiple={tool.multiple}
        disabled={converting}
        onPick={pickFiles}
        onClear={() => setFiles([])}
      />

      {tool.requiresPages && (
        <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.inputLabel, { color: colors.text }]}>Page ranges</Text>
          <TextInput
            value={pageRanges}
            onChangeText={setPageRanges}
            placeholder="e.g. 1-3,5"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
          />
        </View>
      )}

      {converting && (
        <JobProgressCard
          job={jobUpdate}
          progress={uploadProgress}
          label={uploadProgress < 0.45 ? "Uploading..." : "Converting..."}
        />
      )}
      <StatusBanner type={status.type} message={status.message} />

      <TouchableOpacity
        style={[styles.convertBtn, { backgroundColor: colors.primary, opacity: converting ? 0.7 : 1 }]}
        disabled={converting}
        onPress={startConversion}
      >
        {converting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.convertBtnText}>Start Conversion</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "800" },
  desc: { marginTop: 6, fontSize: 14, lineHeight: 20 },
  inputWrap: { marginTop: 16, borderRadius: 12, borderWidth: 1, padding: 12 },
  inputLabel: { fontWeight: "700", marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  convertBtn: { marginTop: 20, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  convertBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
});

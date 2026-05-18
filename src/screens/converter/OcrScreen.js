import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import FilePickerZone from "../../components/converter/FilePickerZone";
import JobProgressCard from "../../components/converter/JobProgressCard";
import StatusBanner from "../../components/converter/StatusBanner";
import { fetchOcrLanguages, uploadAndConvertWithJob, validateFileSize } from "../../services/conversionService";
import { MAX_FILE_SIZE_MB, getToolById } from "../../constants/conversions";
import { notifyConversionFailed, notifyOcrComplete } from "../../services/notificationService";
import { useTheme } from "../../theme/ThemeContext";

export default function OcrScreen({ navigation }) {
  const { colors } = useTheme();
  const tool = getToolById("ocr");
  const [files, setFiles] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [language, setLanguage] = useState("eng");
  const [exportFormat, setExportFormat] = useState("txt");
  const [progress, setProgress] = useState(0);
  const [jobUpdate, setJobUpdate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: "info", message: "" });
  const [ocrResult, setOcrResult] = useState(null);

  useEffect(() => {
    fetchOcrLanguages().then(setLanguages).catch(() => {});
  }, []);

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const validation = validateFileSize(asset.size, MAX_FILE_SIZE_MB);
    if (!validation.valid) {
      Alert.alert("File too large", validation.message);
      return;
    }
    setFiles([{ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size }]);
  };

  const runOcr = async () => {
    if (!files.length) {
      Alert.alert("Select a file", "Pick a PDF or image first.");
      return;
    }

    try {
      setLoading(true);
      setProgress(0.05);
      setJobUpdate({ status: "queued", progress: 0 });
      setStatus({ type: "info", message: "Running OCR..." });

      const response = await uploadAndConvertWithJob({
        tool,
        files,
        language,
        exportFormat,
        onUploadProgress: setProgress,
        onJobUpdate: (update) => {
          setJobUpdate(update);
          if (update.status === "queued") setStatus({ type: "info", message: "OCR job queued." });
          if (update.status === "processing") setStatus({ type: "info", message: "OCR is processing..." });
        },
      });

      setOcrResult(response.result?.ocr);
      setStatus({ type: "success", message: "OCR completed." });
      await notifyOcrComplete("OCR Complete", "Text extracted successfully.", {
        type: "ocr_completed",
        jobId: response.jobId,
        result: response.result,
      });

      navigation.navigate("FilePreview", {
        toolTitle: "OCR Export",
        fileName: response.result?.fileName,
        downloadUrl: response.result?.downloadUrl,
        mimeType: response.result?.mimeType,
        ocrText: response.result?.ocr?.text,
      });
    } catch (error) {
      setJobUpdate((prev) => ({ ...(prev || {}), status: "failed", progress: 100, error: error.message }));
      setStatus({ type: "error", message: error.message });
      await notifyConversionFailed("OCR Failed", error.message, {
        type: "job_failed",
        jobId: jobUpdate?.jobId,
      });
    } finally {
      setLoading(false);
    }
  };

  const shareText = async () => {
    if (!ocrResult?.text) return;
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(ocrResult.text);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>OCR Scanner</Text>
      <Text style={[styles.desc, { color: colors.textMuted }]}>Extract text from scanned PDFs and images.</Text>

      <FilePickerZone files={files} onPick={pickFile} onClear={() => setFiles([])} disabled={loading} />

      <Text style={[styles.label, { color: colors.text }]}>Language</Text>
      <View style={styles.chips}>
        {(languages.length ? languages : [{ code: "eng", label: "English" }]).map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={[styles.chip, { borderColor: colors.border, backgroundColor: language === lang.code ? colors.primarySoft : colors.card }]}
            onPress={() => setLanguage(lang.code)}
          >
            <Text style={{ color: colors.text, fontWeight: "600" }}>{lang.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.label, { color: colors.text }]}>Export as</Text>
      <View style={styles.chips}>
        {["txt", "docx"].map((fmt) => (
          <TouchableOpacity
            key={fmt}
            style={[styles.chip, { borderColor: colors.border, backgroundColor: exportFormat === fmt ? colors.primarySoft : colors.card }]}
            onPress={() => setExportFormat(fmt)}
          >
            <Text style={{ color: colors.text, fontWeight: "600" }}>{fmt.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && <JobProgressCard job={jobUpdate} progress={progress} label="Processing OCR..." />}
      <StatusBanner type={status.type} message={status.message} />

      {ocrResult?.text ? (
        <View style={[styles.resultBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.resultTitle, { color: colors.text }]}>Extracted Text</Text>
          <Text style={{ color: colors.textMuted }} numberOfLines={8}>
            {ocrResult.text}
          </Text>
          <TouchableOpacity onPress={shareText} style={styles.shareBtn}>
            <Text style={{ color: colors.primary, fontWeight: "700" }}>Share Text</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
        disabled={loading}
        onPress={runOcr}
      >
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>Run OCR</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: "800" },
  desc: { marginTop: 6, fontSize: 14 },
  label: { marginTop: 16, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  resultBox: { marginTop: 16, borderWidth: 1, borderRadius: 12, padding: 12 },
  resultTitle: { fontWeight: "700", marginBottom: 8 },
  shareBtn: { marginTop: 10, alignSelf: "flex-start" },
  btn: { marginTop: 20, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnText: { color: "#FFF", fontWeight: "700" },
});

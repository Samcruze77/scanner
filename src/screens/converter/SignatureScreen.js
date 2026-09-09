import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import SignatureScreen from "react-native-signature-canvas";
import { useTheme } from "../../theme/ThemeContext";
import { getApiBaseUrl, uploadFile } from "../../services/api";
import { getToken } from "../../services/authApi";
import * as FileSystem from "expo-file-system";

export default function SignatureScreenComponent({ navigation, route }) {
  const { colors } = useTheme();
  const signatureRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const { fileUri, fileName } = route.params || {};

  const handleOK = async (signature) => {
    try {
      setLoading(true);
      const token = await getToken();
      
      // 1. Save signature to database
      const saveResponse = await fetch(`${getApiBaseUrl()}/signatures`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ signature }),
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json();
        throw new Error(errorData.message || "Failed to save signature");
      }

      // 2. If we have a file, sign it
      if (fileUri) {
        // Use the new cross-platform uploadFile utility
        const result = await uploadFile(
          fileUri,
          `${getApiBaseUrl()}/pdf/sign?signature=${encodeURIComponent(signature)}&x=100&y=100&width=150&height=50`,
          token
        );
        
        Alert.alert("Success", "Document signed successfully!", [
          {
            text: "OK",
            onPress: () => {
              navigation.navigate("FilePreview", {
                fileName: result.data.fileName,
                downloadUrl: result.data.downloadUrl,
                mimeType: result.data.mimeType,
                toolTitle: "Signed Document",
              });
            },
          },
        ]);
      } else {
        Alert.alert("Success", "Signature saved successfully!");
        navigation.goBack();
      }
    } catch (error) {
      console.error("Signature error:", error);
      Alert.alert("Error", error.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleEmpty = () => {
    Alert.alert("Empty", "Please provide a signature first.");
  };

  const handleClear = () => {
    signatureRef.current.clearSignature();
  };

  const handleEnd = () => {
    signatureRef.current.readSignature();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Sign Document</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Draw your signature below
        </Text>
      </View>

      <View style={[styles.signatureContainer, { borderColor: colors.border }]}>
        <SignatureScreen
          ref={signatureRef}
          onOK={handleOK}
          onEmpty={handleEmpty}
          descriptionText="Sign here"
          clearText="Clear"
          confirmText="Save"
          webStyle={`.m-signature-pad--footer { display: none; margin: 0px; }`}
          autoClear={true}
        />
      </View>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, styles.clearButton, { borderColor: colors.primary }]}
          onPress={handleClear}
          disabled={loading}
        >
          <Text style={[styles.buttonText, { color: colors.primary }]}>Clear</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.saveButton, { backgroundColor: colors.primary }]}
          onPress={handleEnd}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={[styles.buttonText, styles.saveButtonText]}>Sign & Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 14,
    marginTop: 4,
  },
  signatureContainer: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#FFF",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
    gap: 12,
  },
  button: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  clearButton: {
    backgroundColor: "transparent",
  },
  saveButton: {
    borderWidth: 0,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  saveButtonText: {
    color: "#FFF",
  },
});

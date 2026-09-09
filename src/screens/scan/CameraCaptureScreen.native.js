import React, { useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Camera } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";

export default function CameraCaptureScreen({ navigation }) {
  const [permission, setPermission] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef(null);

  useEffect(() => {
    Camera.getCameraPermissionsAsync().then(setPermission);
  }, []);

  const requestPermission = async () => {
    const result = await Camera.requestCameraPermissionsAsync();
    setPermission(result);
    return result;
  };

  const handleCapture = async () => {
    if (!cameraRef.current || isCapturing) {
      return;
    }

    try {
      setIsCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      navigation.navigate("ScanPreview", {
        doc: {
          uri: photo.uri,
          name: `Scan_${Date.now()}.jpg`,
          mimeType: "image/jpeg",
          size: undefined,
          source: "Camera",
        },
      });
    } catch {
      Alert.alert("Capture failed", "Unable to capture photo. Please try again.");
    } finally {
      setIsCapturing(false);
    }
  };

  if (!permission) {
    return (
      <View style={styles.cameraStateContainer}>
        <Text style={styles.cameraStateText}>Loading camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.cameraStateContainer}>
        <Text style={styles.cameraStateText}>Camera access is required to scan documents.</Text>
        <TouchableOpacity style={styles.primaryButtonSolid} activeOpacity={0.85} onPress={requestPermission}>
          <Text style={styles.primaryButtonSolidText}>Allow Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.cameraScreen}>
      <Camera ref={cameraRef} style={styles.cameraView} type={Camera.Constants.Type.back} />
      <View style={styles.cameraActionBar}>
        <TouchableOpacity style={styles.cameraCaptureButton} activeOpacity={0.85} onPress={handleCapture}>
          <Ionicons name={isCapturing ? "hourglass-outline" : "camera"} size={24} color="#FFFFFF" />
          <Text style={styles.cameraCaptureText}>{isCapturing ? "Capturing..." : "Capture"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraScreen: {
    flex: 1,
    backgroundColor: "#0F172A",
  },
  cameraView: {
    flex: 1,
  },
  cameraActionBar: {
    padding: 20,
    backgroundColor: "#0F172A",
  },
  cameraCaptureButton: {
    borderRadius: 14,
    backgroundColor: "#1D4ED8",
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  cameraCaptureText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
  cameraStateContainer: {
    flex: 1,
    backgroundColor: "#F4F6FA",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    gap: 14,
  },
  cameraStateText: {
    color: "#334155",
    fontSize: 15,
    textAlign: "center",
  },
  primaryButtonSolid: {
    borderRadius: 14,
    backgroundColor: "#1D4ED8",
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  primaryButtonSolidText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});

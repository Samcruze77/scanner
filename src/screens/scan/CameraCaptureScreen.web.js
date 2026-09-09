import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function CameraCaptureScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Ionicons name="camera-outline" size={48} color="#64748B" />
      <Text style={styles.title}>Camera not available in the browser</Text>
      <Text style={styles.subtitle}>Use Upload on the Dashboard to add a document from your computer.</Text>
      <TouchableOpacity style={styles.button} activeOpacity={0.85} onPress={() => navigation.navigate("DashboardHome")}>
        <Text style={styles.buttonText}>Back to Dashboard</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F6FA",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: "#64748B",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: "#1D4ED8",
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
});

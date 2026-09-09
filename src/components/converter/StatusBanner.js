import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";

export default function StatusBanner({ type = "info", message }) {
  const { colors } = useTheme();
  if (!message) return null;

  const bg = type === "success" ? colors.successBg : type === "error" ? colors.errorBg : colors.primarySoft;
  const textColor = type === "success" ? colors.success : type === "error" ? colors.error : colors.primary;

  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: textColor }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 12, padding: 12, marginTop: 14 },
  text: { fontWeight: "600", fontSize: 14 },
});

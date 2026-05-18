import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";

export default function AuthButton({ title, onPress, loading, variant = "primary", colors }) {
  const isOutline = variant === "outline";

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
      style={[
        styles.btn,
        isOutline
          ? { borderWidth: 1, borderColor: colors.primary, backgroundColor: "transparent" }
          : { backgroundColor: colors.primary },
        loading && { opacity: 0.7 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isOutline ? colors.primary : "#FFFFFF"} />
      ) : (
        <Text style={[styles.text, { color: isOutline ? colors.primary : "#FFFFFF" }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  text: { fontWeight: "700", fontSize: 16 },
});

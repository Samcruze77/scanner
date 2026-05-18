import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeContext";

export default function ConversionTypeCard({ tool, onPress }) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={tool.icon} size={22} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{tool.title}</Text>
      <Text style={[styles.desc, { color: colors.textMuted }]}>{tool.description}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "48%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  title: { fontWeight: "700", fontSize: 15 },
  desc: { marginTop: 6, fontSize: 12, lineHeight: 17 },
});

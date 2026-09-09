import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CONVERSION_TOOLS } from "../../constants/conversions";
import ConversionTypeCard from "../../components/converter/ConversionTypeCard";
import { useTheme } from "../../theme/ThemeContext";

export default function ConverterHomeScreen({ navigation }) {
  const { colors, isDark, toggleMode } = useTheme();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.heading, { color: colors.text }]}>Document Converter</Text>
          <Text style={[styles.subheading, { color: colors.textMuted }]}>
            Convert, merge, split, and compress files
          </Text>
        </View>
        <TouchableOpacity onPress={toggleMode} style={[styles.themeBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name={isDark ? "sunny" : "moon"} size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.quickRow}>
        <TouchableOpacity
          style={[styles.historyBtn, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate("ConversionHistory")}
        >
          <Ionicons name="time-outline" size={18} color="#FFFFFF" />
          <Text style={styles.historyBtnText}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.historyBtn, { backgroundColor: colors.primary }]}
          onPress={() => navigation.navigate("Ocr")}
        >
          <Ionicons name="text-outline" size={18} color="#FFFFFF" />
          <Text style={styles.historyBtnText}>OCR</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.historyBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
          onPress={() => navigation.navigate("NotificationSettings")}
        >
          <Ionicons name="notifications-outline" size={18} color={colors.primary} />
          <Text style={[styles.historyBtnText, { color: colors.text }]}>Alerts</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        {CONVERSION_TOOLS.map((tool) => (
          <ConversionTypeCard key={tool.id} tool={tool} onPress={() => navigation.navigate("ConvertTool", { toolId: tool.id })} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 30 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heading: { fontSize: 28, fontWeight: "800" },
  subheading: { marginTop: 6, fontSize: 14, lineHeight: 20, maxWidth: 260 },
  themeBtn: { borderWidth: 1, borderRadius: 12, padding: 10 },
  quickRow: { marginTop: 18, flexDirection: "row", gap: 10 },
  historyBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  historyBtnText: { color: "#FFFFFF", fontWeight: "700" },
  grid: { marginTop: 18, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
});

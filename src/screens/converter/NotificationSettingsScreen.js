import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getNotificationSettings,
  registerForPushNotifications,
  requestNotificationPermissions,
  saveNotificationSettings,
} from "../../services/notificationService";
import { useTheme } from "../../theme/ThemeContext";

export default function NotificationSettingsScreen() {
  const { colors } = useTheme();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getNotificationSettings().then(setSettings);
  }, []);

  const updateSetting = async (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    setSaving(true);
    await saveNotificationSettings(next);
    setSaving(false);
  };

  const enablePermissions = async () => {
    const granted = await requestNotificationPermissions();
    if (!granted) {
      Alert.alert("Notifications disabled", "Enable notifications in system settings to receive job updates.");
      return;
    }
    await registerForPushNotifications();
    Alert.alert("Notifications enabled", "You will receive conversion and OCR job updates.");
  };

  if (!settings) return null;

  return (
    <View style={[styles.content, { backgroundColor: colors.background }]}>
      <TouchableOpacity style={[styles.permissionBtn, { backgroundColor: colors.primary }]} onPress={enablePermissions}>
        <Ionicons name="notifications-outline" size={18} color="#FFFFFF" />
        <Text style={styles.permissionText}>Enable Notifications</Text>
      </TouchableOpacity>

      <SettingRow
        label="Conversion complete"
        value={settings.conversionComplete}
        colors={colors}
        onValueChange={(value) => updateSetting("conversionComplete", value)}
      />
      <SettingRow
        label="OCR complete"
        value={settings.ocrComplete}
        colors={colors}
        onValueChange={(value) => updateSetting("ocrComplete", value)}
      />
      <SettingRow
        label="Failed jobs"
        value={settings.jobFailed}
        colors={colors}
        onValueChange={(value) => updateSetting("jobFailed", value)}
      />
      <SettingRow
        label="Push notifications"
        value={settings.pushEnabled}
        colors={colors}
        onValueChange={(value) => updateSetting("pushEnabled", value)}
      />
      <Text style={[styles.saving, { color: colors.textMuted }]}>{saving ? "Saving..." : "Settings synced"}</Text>
    </View>
  );
}

function SettingRow({ label, value, onValueChange, colors }) {
  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 20 },
  permissionBtn: {
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  permissionText: { color: "#FFFFFF", fontWeight: "800" },
  row: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: { fontWeight: "700", fontSize: 15 },
  saving: { marginTop: 8, fontSize: 12 },
});

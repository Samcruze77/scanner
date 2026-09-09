import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AuthButton from "../../components/auth/AuthButton";
import { useTheme } from "../../theme/ThemeContext";
import { authenticateWithBiometrics } from "../../services/biometricService";
import { useAuthStore } from "../../store/authStore";

export default function BiometricUnlockScreen({ onUnlocked, onUsePassword }) {
  const { colors } = useTheme();
  const { completeBiometricUnlock } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const unlock = async () => {
    setLoading(true);
    setError(null);
    try {
      await authenticateWithBiometrics("Unlock with Face ID or fingerprint");
      await completeBiometricUnlock();
      onUnlocked?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.iconWrap, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="finger-print" size={48} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>Unlock app</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Use Face ID or fingerprint to access your account
      </Text>

      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}

      <View style={styles.actions}>
        <AuthButton title="Unlock" onPress={unlock} loading={loading} colors={colors} />
        <AuthButton title="Use password instead" onPress={onUsePassword} variant="outline" colors={colors} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24 },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { marginTop: 24, fontSize: 26, fontWeight: "800", textAlign: "center" },
  subtitle: { marginTop: 8, fontSize: 15, textAlign: "center", lineHeight: 22 },
  error: { marginTop: 16, textAlign: "center" },
  actions: { marginTop: 32 },
});

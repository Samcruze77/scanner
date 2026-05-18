import React, { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AuthInput from "../../components/auth/AuthInput";
import AuthButton from "../../components/auth/AuthButton";
import { useTheme } from "../../theme/ThemeContext";
import { useAuthStore } from "../../store/authStore";
import { validateFullName } from "../../utils/validation";
import { isBiometricHardwareAvailable, isBiometricUnlockEnabled } from "../../services/biometricService";

export default function ProfileScreen() {
  const { colors, toggleMode, isDark } = useTheme();
  const { user, updateProfile, logout, enableBiometricUnlock, disableBiometricUnlock, isLoading, error, clearError } =
    useAuthStore();
  const [fullName, setFullName] = useState(user?.fullName || "");
  const [nameError, setNameError] = useState(null);
  const [biometricOn, setBiometricOn] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    (async () => {
      setBiometricAvailable(await isBiometricHardwareAvailable());
      setBiometricOn(await isBiometricUnlockEnabled());
    })();
  }, [user]);

  const planLabel = user?.subscriptionPlan || user?.role || "free";

  const onSave = async () => {
    clearError();
    const err = validateFullName(fullName);
    setNameError(err);
    if (err) return;

    try {
      await updateProfile(fullName.trim());
      Alert.alert("Saved", "Profile updated successfully.");
    } catch {
      /* store error */
    }
  };

  const onToggleBiometric = async (value) => {
    try {
      if (value) {
        await enableBiometricUnlock();
        setBiometricOn(true);
        Alert.alert("Enabled", "Biometric unlock is now on.");
      } else {
        await disableBiometricUnlock();
        setBiometricOn(false);
      }
    } catch (e) {
      Alert.alert("Biometrics", e.message);
      setBiometricOn(false);
    }
  };

  const onLogout = () => {
    Alert.alert("Logout", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: () => logout() },
    ]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="person" size={40} color={colors.primary} />
      </View>

      <Text style={[styles.name, { color: colors.text }]}>{user?.fullName || "User"}</Text>
      <Text style={[styles.email, { color: colors.textMuted }]}>{user?.email}</Text>

      <View style={[styles.badgeRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={{ color: colors.text, fontWeight: "600" }}>Plan: {planLabel}</Text>
        <Text style={{ color: colors.textMuted }}>Conversions: {user?.conversionsUsed ?? 0}</Text>
        <Text style={{ color: user?.emailVerified ? colors.success : colors.error }}>
          {user?.emailVerified ? "Email verified" : "Email not verified"}
        </Text>
      </View>

      {error ? <Text style={{ color: colors.error, marginBottom: 12 }}>{error}</Text> : null}

      {biometricAvailable ? (
        <View style={[styles.switchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: colors.text, fontWeight: "600" }}>Biometric unlock</Text>
          <Switch value={biometricOn} onValueChange={onToggleBiometric} trackColor={{ true: colors.primary }} />
        </View>
      ) : null}

      <AuthInput label="Full name" value={fullName} onChangeText={setFullName} error={nameError} autoCapitalize="words" />

      <AuthButton title="Save profile" onPress={onSave} loading={isLoading} colors={colors} />
      <AuthButton title={isDark ? "Light mode" : "Dark mode"} onPress={toggleMode} variant="outline" colors={colors} />
      <AuthButton title="Logout" onPress={onLogout} variant="outline" colors={{ ...colors, primary: colors.error }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingBottom: 40, alignItems: "center" },
  avatar: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center" },
  name: { marginTop: 16, fontSize: 22, fontWeight: "800" },
  email: { marginTop: 4, fontSize: 14 },
  badgeRow: {
    marginTop: 20,
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  switchRow: {
    marginTop: 16,
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
});

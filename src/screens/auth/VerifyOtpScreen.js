import React, { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import AuthInput from "../../components/auth/AuthInput";
import AuthButton from "../../components/auth/AuthButton";
import { useTheme } from "../../theme/ThemeContext";
import { useAuthStore } from "../../store/authStore";
import { validateOtp } from "../../utils/validation";

export default function VerifyOtpScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { verifyOtp, resendOtp, resetPassword, isLoading, error, clearError } = useAuthStore();
  const email = route.params?.email || "";
  const purpose = route.params?.purpose || "email_verify";
  const devCode = route.params?.devCode;
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState({});

  const isPasswordReset = purpose === "password_reset";

  const onSubmit = async () => {
    clearError();
    const nextErrors = { code: validateOtp(code) };
    if (isPasswordReset && newPassword.length < 8) {
      nextErrors.password = "Password must be at least 8 characters.";
    }
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    try {
      if (isPasswordReset) {
        await resetPassword(email, code, newPassword);
        Alert.alert("Success", "Password updated. Please sign in.", [
          { text: "OK", onPress: () => navigation.navigate("Login") },
        ]);
        return;
      }

      await verifyOtp(email, code, purpose);
    } catch {
      /* store error */
    }
  };

  const onResend = async () => {
    try {
      const result = await resendOtp(email, purpose);
      const devHint = result?.data?.devCode ? `\n\nDev code: ${result.data.devCode}` : "";
      Alert.alert("OTP sent", `A new code was sent to your email.${devHint}`);
    } catch (e) {
      Alert.alert("Error", e.message);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: colors.text }]}>Verify OTP</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Enter the 6-digit code sent to {email}
      </Text>

      {error ? <Text style={[styles.banner, { color: colors.error, backgroundColor: colors.errorBg }]}>{error}</Text> : null}

      {devCode ? (
        <Text style={[styles.devBanner, { color: colors.text, backgroundColor: colors.primarySoft }]}>
          Development code: {devCode}
        </Text>
      ) : null}

      <AuthInput label="OTP Code" value={code} onChangeText={setCode} error={errors.code} keyboardType="number-pad" placeholder="123456" />

      {isPasswordReset ? (
        <AuthInput
          label="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          error={errors.password}
          secureTextEntry
          placeholder="Min. 8 characters"
        />
      ) : null}

      <AuthButton
        title={isPasswordReset ? "Reset password" : "Verify email"}
        onPress={onSubmit}
        loading={isLoading}
        colors={colors}
      />

      <TouchableOpacity onPress={onResend} style={styles.footer}>
        <Text style={{ color: colors.primary, fontWeight: "600" }}>Resend code</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { marginTop: 8, marginBottom: 24, fontSize: 15, lineHeight: 22 },
  banner: { padding: 12, borderRadius: 10, marginBottom: 16 },
  devBanner: { padding: 12, borderRadius: 10, marginBottom: 16, fontWeight: "700", textAlign: "center" },
  footer: { marginTop: 24, alignItems: "center" },
});

import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import AuthInput from "../../components/auth/AuthInput";
import AuthButton from "../../components/auth/AuthButton";
import { useTheme } from "../../theme/ThemeContext";
import { useAuthStore } from "../../store/authStore";
import { validateEmail } from "../../utils/validation";

export default function ForgotPasswordScreen({ navigation }) {
  const { colors } = useTheme();
  const { forgotPassword, isLoading, error, clearError } = useAuthStore();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState({});

  const onSubmit = async () => {
    clearError();
    const emailError = validateEmail(email);
    setErrors({ email: emailError });
    if (emailError) return;

    try {
      await forgotPassword(email.trim());
      navigation.navigate("VerifyOtp", {
        email: email.trim(),
        purpose: "password_reset",
      });
    } catch {
      /* store error */
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>Forgot password</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>
          Enter your email and we will send a 6-digit reset code.
        </Text>

        {error ? <Text style={[styles.banner, { color: colors.error, backgroundColor: colors.errorBg }]}>{error}</Text> : null}

        <AuthInput label="Email" value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" placeholder="you@email.com" />

        <AuthButton title="Send reset code" onPress={onSubmit} loading={isLoading} colors={colors} />

        <TouchableOpacity onPress={() => navigation.navigate("Login")} style={styles.footer}>
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Back to sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { marginTop: 8, marginBottom: 24, fontSize: 15, lineHeight: 22 },
  banner: { padding: 12, borderRadius: 10, marginBottom: 16 },
  footer: { marginTop: 24, alignItems: "center" },
});

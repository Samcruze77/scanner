import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import AuthInput from "../../components/auth/AuthInput";
import AuthButton from "../../components/auth/AuthButton";
import { useTheme } from "../../theme/ThemeContext";
import { useAuthStore } from "../../store/authStore";
import SocialAuthButtons from "../../components/auth/SocialAuthButtons";
import {
  validateConfirmPassword,
  validateEmail,
  validateFullName,
  validatePassword,
} from "../../utils/validation";

export default function RegisterScreen({ navigation }) {
  const { colors } = useTheme();
  const { register, loginWithSocial, isLoading, error, clearError } = useAuthStore();
  const [socialLoading, setSocialLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});

  const onSubmit = async () => {
    clearError();
    const nextErrors = {
      fullName: validateFullName(fullName),
      email: validateEmail(email),
      password: validatePassword(password),
      confirm: validateConfirmPassword(password, confirm),
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    try {
      await register(fullName.trim(), email.trim(), password);
      navigation.navigate("VerifyOtp", { email: email.trim(), purpose: "email_verify" });
    } catch {
      /* store error */
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.text }]}>Create account</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>Start scanning and converting documents</Text>

        {error ? <Text style={[styles.banner, { color: colors.error, backgroundColor: colors.errorBg }]}>{error}</Text> : null}

        <AuthInput label="Full name" value={fullName} onChangeText={setFullName} error={errors.fullName} autoCapitalize="words" placeholder="John Doe" />
        <AuthInput label="Email" value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" placeholder="you@email.com" />
        <AuthInput label="Password" value={password} onChangeText={setPassword} error={errors.password} secureTextEntry placeholder="Min. 8 characters" />
        <AuthInput label="Confirm password" value={confirm} onChangeText={setConfirm} error={errors.confirm} secureTextEntry placeholder="Repeat password" />

        <AuthButton title="Register" onPress={onSubmit} loading={isLoading || socialLoading} colors={colors} />

        <SocialAuthButtons
          loading={isLoading || socialLoading}
          setLoading={setSocialLoading}
          onSuccess={(data) => loginWithSocial(data)}
        />

        <TouchableOpacity onPress={() => navigation.navigate("Login")} style={styles.footer}>
          <Text style={{ color: colors.textMuted }}>
            Already have an account? <Text style={{ color: colors.primary, fontWeight: "700" }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { marginTop: 8, marginBottom: 24, fontSize: 15 },
  banner: { padding: 12, borderRadius: 10, marginBottom: 16 },
  footer: { marginTop: 24, alignItems: "center" },
});

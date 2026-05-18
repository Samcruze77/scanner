import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import AuthInput from "../../components/auth/AuthInput";
import AuthButton from "../../components/auth/AuthButton";
import { useTheme } from "../../theme/ThemeContext";
import { useAuthStore } from "../../store/authStore";
import SocialAuthButtons from "../../components/auth/SocialAuthButtons";
import { validateEmail, validatePassword } from "../../utils/validation";

export default function LoginScreen({ navigation }) {
  const { colors } = useTheme();
  const { login, loginWithSocial, isLoading, error, clearError } = useAuthStore();
  const [socialLoading, setSocialLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});

  const onSubmit = async () => {
    clearError();
    const nextErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    try {
      const result = await login(email.trim(), password);
      if (result.needsVerification) {
        navigation.navigate("VerifyOtp", { email: email.trim(), purpose: "email_verify" });
      }
    } catch {
      /* error in store */
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.text }]}>Welcome back</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>Sign in to continue scanning and converting</Text>

        {error ? <Text style={[styles.banner, { color: colors.error, backgroundColor: colors.errorBg }]}>{error}</Text> : null}

        <AuthInput label="Email" value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" placeholder="you@email.com" />
        <AuthInput label="Password" value={password} onChangeText={setPassword} error={errors.password} secureTextEntry placeholder="••••••••" />

        <TouchableOpacity onPress={() => navigation.navigate("ForgotPassword")} style={styles.linkWrap}>
          <Text style={{ color: colors.primary, fontWeight: "600" }}>Forgot password?</Text>
        </TouchableOpacity>

        <AuthButton title="Sign In" onPress={onSubmit} loading={isLoading || socialLoading} colors={colors} />

        <SocialAuthButtons
          loading={isLoading || socialLoading}
          setLoading={setSocialLoading}
          onSuccess={(data) => loginWithSocial(data)}
        />

        <TouchableOpacity onPress={() => navigation.navigate("Register")} style={styles.footer}>
          <Text style={{ color: colors.textMuted }}>
            No account? <Text style={{ color: colors.primary, fontWeight: "700" }}>Register</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: "800" },
  subtitle: { marginTop: 8, marginBottom: 24, fontSize: 15, lineHeight: 22 },
  banner: { padding: 12, borderRadius: 10, marginBottom: 16, overflow: "hidden" },
  linkWrap: { alignSelf: "flex-end", marginBottom: 8 },
  footer: { marginTop: 24, alignItems: "center" },
});

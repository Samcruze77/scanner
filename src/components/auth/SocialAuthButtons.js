import React, { useEffect } from "react";
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeContext";
import {
  isAppleSignInAvailable,
  isGoogleConfigured,
  signInWithApple,
  signInWithGoogleIdToken,
  useGoogleAuthRequest,
} from "../../services/socialAuth";

export default function SocialAuthButtons({ onSuccess, loading, setLoading }) {
  const { colors } = useTheme();
  const [request, response, promptGoogle] = useGoogleAuthRequest();

  useEffect(() => {
    if (response?.type !== "success") return;

    (async () => {
      try {
        setLoading?.(true);
        const idToken = response.authentication?.idToken || response.params?.id_token;
        if (!idToken) throw new Error("Google did not return an ID token.");
        const data = await signInWithGoogleIdToken(idToken);
        onSuccess?.(data);
      } catch (error) {
        Alert.alert("Google Sign-In failed", error.message);
      } finally {
        setLoading?.(false);
      }
    })();
  }, [response]);

  const onGoogle = async () => {
    if (!isGoogleConfigured()) {
      Alert.alert(
        "Google not configured",
        "Add EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID (and iOS/Android IDs) to your .env file."
      );
      return;
    }
    try {
      await promptGoogle();
    } catch (error) {
      Alert.alert("Google Sign-In", error.message);
    }
  };

  const onApple = async () => {
    try {
      setLoading?.(true);
      const data = await signInWithApple();
      onSuccess?.(data);
    } catch (error) {
      if (error.code !== "ERR_CANCELED") {
        Alert.alert("Apple Sign-In failed", error.message);
      }
    } finally {
      setLoading?.(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.or, { color: colors.textMuted }]}>or continue with</Text>

      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={onGoogle}
        disabled={loading || !request}
      >
        <Ionicons name="logo-google" size={20} color="#DB4437" />
        <Text style={[styles.btnText, { color: colors.text }]}>Google</Text>
      </TouchableOpacity>

      {isAppleSignInAvailable() ? (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={onApple}
          disabled={loading}
        >
          <Ionicons name="logo-apple" size={22} color={colors.text} />
          <Text style={[styles.btnText, { color: colors.text }]}>Apple</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 20, gap: 10 },
  or: { textAlign: "center", marginBottom: 4, fontSize: 13 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
  },
  btnText: { fontWeight: "700", fontSize: 15 },
});

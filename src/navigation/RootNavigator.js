import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuthStore } from "../store/authStore";
import { useTheme } from "../theme/ThemeContext";
import AuthStack from "./AuthStack";
import BiometricUnlockScreen from "../screens/auth/BiometricUnlockScreen";
import LoginScreen from "../screens/auth/LoginScreen";
import RegisterScreen from "../screens/auth/RegisterScreen";
import ForgotPasswordScreen from "../screens/auth/ForgotPasswordScreen";
import VerifyOtpScreen from "../screens/auth/VerifyOtpScreen";

const Stack = createNativeStackNavigator();

export default function RootNavigator({ AuthenticatedComponent }) {
  const { colors } = useTheme();
  const {
    isAuthenticated,
    isLoading,
    needsBiometricUnlock,
    pendingEmail,
    pendingOtpPurpose,
    bootstrap,
    skipBiometricUnlock,
  } = useAuthStore();
  const [bioKey, setBioKey] = useState(0);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (needsBiometricUnlock && !isAuthenticated) {
    return (
      <BiometricUnlockScreen
        key={bioKey}
        onUnlocked={() => setBioKey((k) => k + 1)}
        onUsePassword={async () => {
          await skipBiometricUnlock();
        }}
      />
    );
  }

  return (
    <Stack.Navigator initialRouteName="Main" screenOptions={{ headerShown: false }}>
      {AuthenticatedComponent ? (
        <Stack.Screen name="Main" component={AuthenticatedComponent} />
      ) : null}
      {!isAuthenticated ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: true, title: "Sign Up" }} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ headerShown: true, title: "Forgot Password" }} />
          <Stack.Screen
            name="VerifyOtp"
            component={VerifyOtpScreen}
            options={{ headerShown: true, title: "Verify OTP" }}
            initialParams={{ email: pendingEmail, purpose: pendingOtpPurpose }}
          />
          <Stack.Screen name="Auth" component={AuthStack} />
        </>
      ) : null}
    </Stack.Navigator>
  );
}

import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "../screens/auth/LoginScreen";
import RegisterScreen from "../screens/auth/RegisterScreen";
import ForgotPasswordScreen from "../screens/auth/ForgotPasswordScreen";
import VerifyOtpScreen from "../screens/auth/VerifyOtpScreen";
import { useTheme } from "../theme/ThemeContext";
import { useAuthStore } from "../store/authStore";

const Stack = createNativeStackNavigator();

export default function AuthStack() {
  const { colors } = useTheme();
  const pendingEmail = useAuthStore((s) => s.pendingEmail);
  const pendingOtpPurpose = useAuthStore((s) => s.pendingOtpPurpose);

  const initialRoute =
    pendingEmail && pendingOtpPurpose ? "VerifyOtp" : "Login";

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ title: "Register" }} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: "Forgot Password" }} />
      <Stack.Screen
        name="VerifyOtp"
        component={VerifyOtpScreen}
        options={{ title: "Verify OTP" }}
        initialParams={{ email: pendingEmail, purpose: pendingOtpPurpose }}
      />
    </Stack.Navigator>
  );
}

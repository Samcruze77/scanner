import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuthStore } from "../store/authStore";
import { useTheme } from "../theme/ThemeContext";
import AuthStack from "./AuthStack";
import BiometricUnlockScreen from "../screens/auth/BiometricUnlockScreen";

const Stack = createNativeStackNavigator();

export default function RootNavigator({ AuthenticatedComponent }) {
  const { colors } = useTheme();
  const { isAuthenticated, isLoading, needsBiometricUnlock, bootstrap, skipBiometricUnlock } = useAuthStore();
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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated && AuthenticatedComponent ? (
        <Stack.Screen name="Main" component={AuthenticatedComponent} />
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
}

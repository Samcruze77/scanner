import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ConverterHomeScreen from "../screens/converter/ConverterHomeScreen";
import ConvertToolScreen from "../screens/converter/ConvertToolScreen";
import ConversionHistoryScreen from "../screens/converter/ConversionHistoryScreen";
import FilePreviewScreen from "../screens/converter/FilePreviewScreen";
import OcrScreen from "../screens/converter/OcrScreen";
import SignatureScreen from "../screens/converter/SignatureScreen";
import DocumentEditorScreen from "../screens/converter/DocumentEditorScreen";
import NotificationSettingsScreen from "../screens/converter/NotificationSettingsScreen";
import { useTheme } from "../theme/ThemeContext";

const Stack = createNativeStackNavigator();

export default function ConverterStack() {
  const { colors } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="ConverterHome" component={ConverterHomeScreen} options={{ title: "Converter" }} />
      <Stack.Screen name="Ocr" component={OcrScreen} options={{ title: "OCR" }} />
      <Stack.Screen name="ConvertTool" component={ConvertToolScreen} options={{ title: "Convert" }} />
      <Stack.Screen name="ConversionHistory" component={ConversionHistoryScreen} options={{ title: "History" }} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ title: "Notifications" }} />
      <Stack.Screen name="FilePreview" component={FilePreviewScreen} options={{ title: "Preview" }} />
      <Stack.Screen name="Signature" component={SignatureScreen} options={{ title: "Sign Document" }} />
      <Stack.Screen name="DocumentEditor" component={DocumentEditorScreen} options={{ title: "Edit Document" }} />
    </Stack.Navigator>
  );
}

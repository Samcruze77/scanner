import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";

export default function AuthInput({
  label,
  value,
  onChangeText,
  error,
  secureTextEntry,
  keyboardType = "default",
  autoCapitalize = "none",
  placeholder,
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: colors.text }]}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.card,
            borderColor: error ? colors.error : colors.border,
          },
        ]}
      />
      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontWeight: "600", marginBottom: 6, fontSize: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { marginTop: 4, fontSize: 12 },
});

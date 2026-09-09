import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Header({ navigation }) {
  const insets = useSafeAreaInsets();
  const openNotifications = () => {
    navigation.getParent()?.navigate("Tools", { screen: "NotificationSettings" });
  };

  return (
    <View style={[styles.wrap, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.brandRow}>
        <View style={styles.logo}>
          <Ionicons name="scan" size={22} color="#FFFFFF" />
        </View>
        <View>
          <Text style={styles.name}>DocuScan</Text>
          <Text style={styles.caption}>Smart scanner</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.iconButton} activeOpacity={0.75} onPress={openNotifications}>
          <Ionicons name="notifications-outline" size={20} color="#111827" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.loginButton} activeOpacity={0.8} onPress={() => navigation.navigate("Login")}>
          <Text style={styles.loginText}>Login</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.signupButton} activeOpacity={0.85} onPress={() => navigation.navigate("Register")}>
          <Text style={styles.signupText}>Sign Up</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#FFFFFF",
    borderBottomColor: "#EEF2F7",
    borderBottomWidth: 1,
    paddingBottom: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    ...Platform.select({
      ios: { shadowColor: "#2563EB", shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
      android: { elevation: 3 },
      default: { boxShadow: "0 8px 20px rgba(37, 99, 235, 0.18)" },
    }),
  },
  name: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "800",
  },
  caption: {
    marginTop: 1,
    color: "#6B7280",
    fontSize: 12,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  loginButton: {
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  loginText: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "700",
  },
  signupButton: {
    minHeight: 38,
    borderRadius: 19,
    backgroundColor: "#2563EB",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  signupText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
});

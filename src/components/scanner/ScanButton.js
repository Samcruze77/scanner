import React, { useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function ScanButton({ onPress }) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value) => {
    Animated.spring(scale, {
      toValue: value,
      friction: 6,
      tension: 130,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.shadow, { transform: [{ scale }] }]}>
      <Pressable onPress={onPress} onPressIn={() => animateTo(0.97)} onPressOut={() => animateTo(1)} style={styles.button}>
        <View style={styles.iconWrap}>
          <Ionicons name="scan-outline" size={30} color="#2563EB" />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>Scan Document</Text>
          <Text style={styles.subtitle}>Capture, crop, enhance, and save</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color="#DBEAFE" />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    marginTop: 22,
    borderRadius: 28,
    ...Platform.select({
      ios: { shadowColor: "#1D4ED8", shadowOpacity: 0.24, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
      android: { elevation: 5 },
      default: { boxShadow: "0 16px 36px rgba(29, 78, 216, 0.22)" },
    }),
  },
  button: {
    minHeight: 112,
    borderRadius: 28,
    backgroundColor: "#2563EB",
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  iconWrap: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 5,
    color: "#DBEAFE",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
});

import React, { useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function ActionCard({ icon, title, description, accent = "#2563EB", onPress }) {
  const lift = useRef(new Animated.Value(0)).current;

  const translateY = lift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -3],
  });

  const animateTo = (value) => {
    Animated.timing(lift, {
      toValue: value,
      duration: 140,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY }] }]}>
      <Pressable onPress={onPress} onPressIn={() => animateTo(1)} onPressOut={() => animateTo(0)} style={styles.card}>
        <View style={[styles.iconWrap, { backgroundColor: `${accent}14` }]}>
          <Ionicons name={icon} size={23} color={accent} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "48%",
    minWidth: 150,
  },
  card: {
    minHeight: 140,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    ...Platform.select({
      ios: { shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
      android: { elevation: 2 },
      default: { boxShadow: "0 12px 26px rgba(15, 23, 42, 0.06)" },
    }),
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "800",
  },
  description: {
    marginTop: 6,
    color: "#6B7280",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
});

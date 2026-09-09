import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const icons = {
  Home: ["home-outline", "home"],
  Scans: ["albums-outline", "albums"],
  Tools: ["construct-outline", "construct"],
  Profile: ["person-outline", "person"],
};

export default function BottomNav({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const label = options.tabBarLabel ?? options.title ?? route.name;
        const [outline, filled] = icons[route.name] || ["ellipse-outline", "ellipse"];

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <TouchableOpacity key={route.key} activeOpacity={0.78} onPress={onPress} style={styles.item}>
            <View style={[styles.iconWrap, isFocused && styles.iconWrapActive]}>
              <Ionicons name={isFocused ? filled : outline} size={21} color={isFocused ? "#2563EB" : "#6B7280"} />
            </View>
            <Text style={[styles.label, isFocused && styles.labelActive]} numberOfLines={1}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#FFFFFF",
    borderTopColor: "#E5E7EB",
    borderTopWidth: 1,
    paddingTop: 9,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    ...Platform.select({
      ios: { shadowColor: "#0F172A", shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: -8 } },
      android: { elevation: 12 },
      default: { boxShadow: "0 -12px 28px rgba(15, 23, 42, 0.08)" },
    }),
  },
  item: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrap: {
    width: 38,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapActive: {
    backgroundColor: "#EFF6FF",
  },
  label: {
    marginTop: 3,
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
  },
  labelActive: {
    color: "#2563EB",
  },
});

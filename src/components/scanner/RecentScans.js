import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function RecentScans({ items = [] }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Recent Scans</Text>
        <TouchableOpacity activeOpacity={0.75}>
          <Text style={styles.link}>View all</Text>
        </TouchableOpacity>
      </View>

      {items.map((item) => (
        <TouchableOpacity key={item.id} style={styles.item} activeOpacity={0.8}>
          <View style={styles.fileIcon}>
            <Ionicons name="document-text-outline" size={21} color="#2563EB" />
          </View>
          <View style={styles.meta}>
            <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.detail}>{item.date} · {item.pages} page{item.pages > 1 ? "s" : ""} · {item.size}</Text>
          </View>
          <Ionicons name="ellipsis-horizontal" size={21} color="#9CA3AF" />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 26,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "900",
  },
  link: {
    color: "#2563EB",
    fontSize: 13,
    fontWeight: "800",
  },
  item: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 13,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "800",
  },
  detail: {
    marginTop: 4,
    color: "#6B7280",
    fontSize: 12,
    fontWeight: "600",
  },
});

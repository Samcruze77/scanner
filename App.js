import "react-native-gesture-handler";
import React, { useMemo } from "react";
import { ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

const historyData = [
  { id: "1", name: "Invoice_042.pdf", date: "Apr 14, 2026", pages: 3, size: "1.2 MB" },
  { id: "2", name: "Passport_Scan.pdf", date: "Apr 13, 2026", pages: 1, size: "560 KB" },
  { id: "3", name: "Receipt_Bundle.pdf", date: "Apr 11, 2026", pages: 5, size: "2.4 MB" },
  { id: "4", name: "Contract_Page.pdf", date: "Apr 8, 2026", pages: 2, size: "900 KB" },
];

function DashboardScreen({ navigation }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Dashboard</Text>
      <Text style={styles.subheading}>Scan, organize, and export your documents quickly.</Text>

      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>Ready to Scan</Text>
        <Text style={styles.heroText}>Capture receipts, invoices, IDs, and notes in seconds.</Text>
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("ScanPreview")}
        >
          <Text style={styles.primaryButtonText}>Scan New Document</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Quick Actions</Text>
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionCard} activeOpacity={0.85} onPress={() => navigation.navigate("ScanPreview")}>
          <Text style={styles.actionIcon}>+ </Text>
          <Text style={styles.actionTitle}>New Scan</Text>
          <Text style={styles.actionText}>Open camera scanner</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionCard} activeOpacity={0.85} onPress={() => navigation.navigate("DocumentDetail")}>
          <Text style={styles.actionIcon}>[ ] </Text>
          <Text style={styles.actionTitle}>Import File</Text>
          <Text style={styles.actionText}>Use existing image/PDF</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>24</Text>
          <Text style={styles.statLabel}>Total Scans</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>11</Text>
          <Text style={styles.statLabel}>This Month</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>8.6MB</Text>
          <Text style={styles.statLabel}>Storage Used</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function ScanPreviewScreen({ navigation }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Scan Preview</Text>
      <Text style={styles.subheading}>Mock preview screen for scanned document before saving/export.</Text>

      <View style={styles.previewFrame}>
        <Text style={styles.previewFrameText}>Document Preview Placeholder</Text>
      </View>

      <View style={styles.previewActions}>
        <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.85}>
          <Text style={styles.secondaryButtonText}>Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primaryButtonSolid}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("DocumentDetail")}
        >
          <Text style={styles.primaryButtonSolidText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function DocumentDetailScreen() {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Document Detail</Text>
      <Text style={styles.subheading}>Frontend-only metadata and action layout.</Text>

      <View style={styles.detailCard}>
        <Text style={styles.detailName}>Invoice_042.pdf</Text>
        <Text style={styles.detailMeta}>Created: Apr 14, 2026</Text>
        <Text style={styles.detailMeta}>Pages: 3</Text>
        <Text style={styles.detailMeta}>Size: 1.2 MB</Text>
      </View>

      <Text style={styles.sectionLabel}>Actions</Text>
      <View style={styles.detailActionsRow}>
        <TouchableOpacity style={styles.actionChip} activeOpacity={0.85}>
          <Text style={styles.actionChipText}>Rename</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionChip} activeOpacity={0.85}>
          <Text style={styles.actionChipText}>Share</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionChip} activeOpacity={0.85}>
          <Text style={styles.actionChipText}>Export</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function HistoryScreen() {
  const list = useMemo(() => historyData, []);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>History</Text>
      <Text style={styles.subheading}>Your previously scanned documents appear here.</Text>

      {list.map((item) => (
        <TouchableOpacity key={item.id} style={styles.historyCard} activeOpacity={0.85}>
          <View style={styles.historyTop}>
            <Text style={styles.historyName}>{item.name}</Text>
            <View style={styles.tag}>
              <Text style={styles.tagText}>PDF</Text>
            </View>
          </View>
          <Text style={styles.historyMeta}>
            {item.date}  -  {item.pages} page{item.pages > 1 ? "s" : ""}  -  {item.size}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator();

function DashboardStackNavigator() {
  return (
    <DashboardStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#FFFFFF" },
        headerShadowVisible: false,
        headerTitleStyle: { color: "#111827", fontWeight: "700" },
        contentStyle: { backgroundColor: "#F4F6FA" },
      }}
    >
      <DashboardStack.Screen name="DashboardHome" component={DashboardScreen} options={{ title: "Dashboard", headerShown: false }} />
      <DashboardStack.Screen name="ScanPreview" component={ScanPreviewScreen} options={{ title: "Scan Preview" }} />
      <DashboardStack.Screen name="DocumentDetail" component={DocumentDetailScreen} options={{ title: "Document Detail" }} />
    </DashboardStack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <ExpoStatusBar style="dark" />
      <StatusBar barStyle="dark-content" />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabLabel,
          tabBarActiveTintColor: "#1D4ED8",
          tabBarInactiveTintColor: "#6B7280",
          tabBarIcon: ({ focused, color }) => {
            const iconName = focused ? "ellipse" : "ellipse-outline";
            return <Ionicons name={iconName} size={18} color={color} />;
          },
        }}
      >
        <Tab.Screen
          name="Dashboard"
          component={DashboardStackNavigator}
          options={{
            tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
          }}
        />
        <Tab.Screen
          name="History"
          component={HistoryScreen}
          options={{
            tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F6FA",
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 30,
  },
  heading: {
    fontSize: 30,
    fontWeight: "800",
    color: "#111827",
  },
  subheading: {
    marginTop: 6,
    fontSize: 15,
    lineHeight: 21,
    color: "#6B7280",
  },
  heroCard: {
    marginTop: 22,
    borderRadius: 18,
    backgroundColor: "#1E40AF",
    padding: 18,
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
  },
  heroText: {
    marginTop: 8,
    color: "#DBEAFE",
    fontSize: 14,
    lineHeight: 20,
  },
  primaryButton: {
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: "#1E3A8A",
    fontWeight: "700",
  },
  sectionLabel: {
    marginTop: 22,
    marginBottom: 10,
    color: "#111827",
    fontWeight: "700",
    fontSize: 17,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  actionIcon: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1D4ED8",
  },
  actionTitle: {
    marginTop: 8,
    fontWeight: "700",
    color: "#111827",
  },
  actionText: {
    marginTop: 5,
    color: "#6B7280",
    fontSize: 12,
    lineHeight: 18,
  },
  statsRow: {
    marginTop: 18,
    flexDirection: "row",
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  statValue: {
    color: "#111827",
    fontWeight: "800",
    fontSize: 15,
  },
  statLabel: {
    marginTop: 4,
    color: "#6B7280",
    fontSize: 12,
  },
  historyCard: {
    marginTop: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  historyTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyName: {
    fontSize: 15,
    color: "#111827",
    fontWeight: "700",
    flexShrink: 1,
    paddingRight: 12,
  },
  tag: {
    borderRadius: 999,
    backgroundColor: "#E0E7FF",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: {
    color: "#3730A3",
    fontWeight: "700",
    fontSize: 11,
  },
  historyMeta: {
    marginTop: 8,
    color: "#6B7280",
    fontSize: 12,
  },
  tabBar: {
    height: 72,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    elevation: 0,
    shadowOpacity: 0,
  },
  tabLabel: {
    fontWeight: "700",
    fontSize: 13,
    marginBottom: 6,
  },
  previewFrame: {
    marginTop: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#DBEAFE",
    height: 280,
    justifyContent: "center",
    alignItems: "center",
  },
  previewFrameText: {
    color: "#1E3A8A",
    fontWeight: "600",
  },
  previewActions: {
    marginTop: 20,
    flexDirection: "row",
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#93C5FD",
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: "#1E3A8A",
    fontWeight: "700",
  },
  primaryButtonSolid: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: "#1D4ED8",
    alignItems: "center",
    paddingVertical: 12,
  },
  primaryButtonSolidText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  detailCard: {
    marginTop: 22,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  detailName: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 10,
  },
  detailMeta: {
    fontSize: 13,
    color: "#4B5563",
    marginBottom: 6,
  },
  detailActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionChip: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionChipText: {
    color: "#374151",
    fontWeight: "600",
  },
});

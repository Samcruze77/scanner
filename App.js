import "react-native-gesture-handler";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { Alert, Animated, Image, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import CameraCaptureScreen from "./src/screens/scan/CameraCaptureScreen";
import ConverterStack from "./src/navigation/ConverterStack";
import RootNavigator from "./src/navigation/RootNavigator";
import ProfileScreen from "./src/screens/auth/ProfileScreen";
import Header from "./src/components/scanner/Header";
import ScanButton from "./src/components/scanner/ScanButton";
import ActionCard from "./src/components/scanner/ActionCard";
import RecentScans from "./src/components/scanner/RecentScans";
import BottomNav from "./src/components/scanner/BottomNav";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { useAuthStore } from "./src/store/authStore";
import { registerBackgroundConversionTasks } from "./src/services/backgroundTasks";
import { cropImageDocument } from "./src/services/imageCropper";
import { addNotificationResponseListener, registerForPushNotifications } from "./src/services/notificationService";

const historyData = [
  { id: "1", name: "Invoice_042.pdf", date: "Apr 14, 2026", pages: 3, size: "1.2 MB" },
  { id: "2", name: "Passport_Scan.pdf", date: "Apr 13, 2026", pages: 1, size: "560 KB" },
  { id: "3", name: "Receipt_Bundle.pdf", date: "Apr 11, 2026", pages: 5, size: "2.4 MB" },
  { id: "4", name: "Contract_Page.pdf", date: "Apr 8, 2026", pages: 2, size: "900 KB" },
];

function DashboardScreen({ navigation }) {
  const [isPickingFile, setIsPickingFile] = useState(false);
  const introAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(introAnim, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [introAnim]);

  const handleUpload = async () => {
    try {
      setIsPickingFile(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/*", "application/pdf"],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const picked = result.assets[0];
      const doc = await cropImageDocument({
        uri: picked.uri,
        name: picked.name || "Uploaded Document",
        mimeType: picked.mimeType || "application/octet-stream",
        size: picked.size,
        source: "Upload",
      });

      navigation.navigate("ScanPreview", {
        doc,
      });
    } catch (error) {
      Alert.alert("Upload failed", "Unable to pick a file. Please try again.");
    } finally {
      setIsPickingFile(false);
    }
  };

  return (
    <View style={styles.homeShell}>
      <Header navigation={navigation} />
      <ScrollView contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
        <Animated.View
          style={{
            opacity: introAnim,
            transform: [
              {
                translateY: introAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [12, 0],
                }),
              },
            ],
          }}
        >
          <View style={styles.heroIntro}>
            <Text style={styles.kicker}>PDFScanner</Text>
            <Text style={styles.heading}>Scan, organize, and export in seconds.</Text>
            <Text style={styles.subheading}>A clean workspace for receipts, IDs, notes, contracts, and every paper trail in between.</Text>
          </View>

          <ScanButton onPress={() => navigation.navigate("CameraCapture")} />

          <View style={styles.metricsRow}>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>24</Text>
              <Text style={styles.metricLabel}>Scans</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>11</Text>
              <Text style={styles.metricLabel}>This month</Text>
            </View>
            <View style={styles.metricCard}>
              <Text style={styles.metricValue}>8.6MB</Text>
              <Text style={styles.metricLabel}>Storage</Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Quick Tools</Text>
          </View>
          <View style={styles.actionGrid}>
            <ActionCard
              icon="images-outline"
              title="Import from Gallery"
              description={isPickingFile ? "Opening picker..." : "Use an image or PDF already on your device"}
              accent="#059669"
              onPress={handleUpload}
            />
            <ActionCard
              icon="text-outline"
              title="OCR Text"
              description="Extract searchable text from scanned pages"
              accent="#7C3AED"
              onPress={() => navigation.getParent()?.navigate("Tools", { screen: "Ocr" })}
            />
            <ActionCard
              icon="document-attach-outline"
              title="Convert to PDF"
              description="Package images and files into polished PDFs"
              accent="#EA580C"
              onPress={() => navigation.getParent()?.navigate("Tools", { screen: "ConvertTool", params: { toolId: "image-to-pdf" } })}
            />
            <ActionCard
              icon="folder-open-outline"
              title="Recent Scans"
              description="Jump back into your latest documents"
              accent="#2563EB"
              onPress={() => navigation.getParent()?.navigate("Scans")}
            />
          </View>

          <RecentScans items={historyData.slice(0, 3)} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function ScanPreviewScreen({ navigation, route }) {
  const doc = route.params?.doc;
  const isImage = doc?.mimeType?.startsWith("image/");

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Scan Preview</Text>
      <Text style={styles.subheading}>Review document before continuing to details.</Text>

      <View style={styles.previewFrame}>
        {isImage && doc?.uri ? (
          <Image source={{ uri: doc.uri }} style={styles.previewImage} resizeMode="cover" />
        ) : (
          <Text style={styles.previewFrameText}>{doc?.name || "Document Preview Placeholder"}</Text>
        )}
      </View>
      <Text style={styles.previewMeta}>Source: {doc?.source || "Unknown"}{doc?.name ? `  -  ${doc.name}` : ""}</Text>

      <View style={styles.previewActions}>
        <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.85} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryButtonText}>Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primaryButtonSolid}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("DocumentDetail", { doc })}
        >
          <Text style={styles.primaryButtonSolidText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function DocumentDetailScreen({ route }) {
  const doc = route.params?.doc;

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Document Detail</Text>
      <Text style={styles.subheading}>Captured/uploaded document metadata and action layout.</Text>

      <View style={styles.detailCard}>
        <Text style={styles.detailName}>{doc?.name || "Untitled Document"}</Text>
        <Text style={styles.detailMeta}>Created: {new Date().toLocaleDateString()}</Text>
        <Text style={styles.detailMeta}>Type: {doc?.mimeType || "unknown"}</Text>
        <Text style={styles.detailMeta}>Size: {doc?.size ? `${Math.round(doc.size / 1024)} KB` : "N/A"}</Text>
        <Text style={styles.detailMeta}>Source: {doc?.source || "Unknown"}</Text>
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

function ProfileGateway({ navigation }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated) {
    return <ProfileScreen />;
  }

  return (
    <View style={styles.profilePrompt}>
      <View style={styles.profilePromptIcon}>
        <Ionicons name="person-outline" size={36} color="#2563EB" />
      </View>
      <Text style={styles.profilePromptTitle}>Your scanning workspace</Text>
      <Text style={styles.profilePromptText}>Sign in to sync scans, protect documents, and keep conversion history across devices.</Text>
      <TouchableOpacity style={styles.profilePrimary} activeOpacity={0.85} onPress={() => navigation.navigate("Login")}>
        <Ionicons name="log-in-outline" size={18} color="#FFFFFF" />
        <Text style={styles.profilePrimaryText}>Login</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.profileSecondary} activeOpacity={0.85} onPress={() => navigation.navigate("Register")}>
        <Text style={styles.profileSecondaryText}>Create account</Text>
      </TouchableOpacity>
    </View>
  );
}

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

function openNotificationResult(data) {
  if (!navigationRef.isReady() || !data?.jobId) return;
  navigationRef.navigate("Main", {
    screen: "Tools",
    params: {
      screen: "FilePreview",
      params: {
        jobId: data.jobId,
        ...(data.result || {}),
      },
    },
  });
}

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
      <DashboardStack.Screen name="CameraCapture" component={CameraCaptureScreen} options={{ title: "Camera Scanner" }} />
      <DashboardStack.Screen name="ScanPreview" component={ScanPreviewScreen} options={{ title: "Scan Preview" }} />
      <DashboardStack.Screen name="DocumentDetail" component={DocumentDetailScreen} options={{ title: "Document Detail" }} />
    </DashboardStack.Navigator>
  );
}

function RootTabs() {
  const { colors, isDark } = useTheme();

  return (
    <>
      <ExpoStatusBar style={isDark ? "light" : "dark"} />
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <Tab.Navigator
        tabBar={(props) => <BottomNav {...props} />}
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
        }}
      >
        <Tab.Screen
          name="Home"
          component={DashboardStackNavigator}
          options={{
            title: "Home",
          }}
        />
        <Tab.Screen
          name="Scans"
          component={HistoryScreen}
          options={{
            title: "Scans",
          }}
        />
        <Tab.Screen
          name="Tools"
          component={ConverterStack}
          options={{
            title: "Tools",
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileGateway}
          options={{
            headerShown: false,
            title: "Profile",
          }}
        />
      </Tab.Navigator>
    </>
  );
}

export default function App() {
  useEffect(() => {
    if (Platform.OS === "web") return undefined;

    registerBackgroundConversionTasks().catch(() => {});
    registerForPushNotifications().catch(() => {});
    const subscription = addNotificationResponseListener(openNotificationResult);
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef}>
          <RootNavigator AuthenticatedComponent={RootTabs} />
        </NavigationContainer>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F4F6FA",
  },
  homeShell: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  homeContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    backgroundColor: "#F8FAFC",
  },
  heroIntro: {
    paddingTop: 2,
  },
  kicker: {
    color: "#2563EB",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase",
    marginBottom: 8,
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
  metricsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  metricCard: {
    flex: 1,
    minHeight: 74,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  metricValue: {
    color: "#111827",
    fontSize: 18,
    fontWeight: "900",
  },
  metricLabel: {
    marginTop: 3,
    color: "#6B7280",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  sectionHeader: {
    marginTop: 26,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
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
    overflow: "hidden",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewFrameText: {
    color: "#1E3A8A",
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 16,
  },
  previewMeta: {
    marginTop: 10,
    color: "#475569",
    fontSize: 12,
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
  profilePrompt: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  profilePromptIcon: {
    width: 86,
    height: 86,
    borderRadius: 30,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  profilePromptTitle: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  profilePromptText: {
    marginTop: 8,
    color: "#6B7280",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 360,
  },
  profilePrimary: {
    marginTop: 24,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#2563EB",
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "stretch",
    maxWidth: 360,
  },
  profilePrimaryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  profileSecondary: {
    marginTop: 12,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    maxWidth: 360,
  },
  profileSecondaryText: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "800",
  },
});

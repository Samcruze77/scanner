import "react-native-gesture-handler";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { NavigationContainer, createNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import ConverterStack from "./src/navigation/ConverterStack";
import RootNavigator from "./src/navigation/RootNavigator";
import ProfileScreen from "./src/screens/auth/ProfileScreen";
import { ThemeProvider, useTheme } from "./src/theme/ThemeContext";
import { registerBackgroundConversionTasks } from "./src/services/backgroundTasks";
import { addNotificationResponseListener, registerForPushNotifications } from "./src/services/notificationService";

const historyData = [
  { id: "1", name: "Invoice_042.pdf", date: "Apr 14, 2026", pages: 3, size: "1.2 MB" },
  { id: "2", name: "Passport_Scan.pdf", date: "Apr 13, 2026", pages: 1, size: "560 KB" },
  { id: "3", name: "Receipt_Bundle.pdf", date: "Apr 11, 2026", pages: 5, size: "2.4 MB" },
  { id: "4", name: "Contract_Page.pdf", date: "Apr 8, 2026", pages: 2, size: "900 KB" },
];

function DashboardScreen({ navigation }) {
  const [isPickingFile, setIsPickingFile] = useState(false);

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
      navigation.navigate("ScanPreview", {
        doc: {
          uri: picked.uri,
          name: picked.name || "Uploaded Document",
          mimeType: picked.mimeType || "application/octet-stream",
          size: picked.size,
          source: "Upload",
        },
      });
    } catch (error) {
      Alert.alert("Upload failed", "Unable to pick a file. Please try again.");
    } finally {
      setIsPickingFile(false);
    }
  };

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
          onPress={() => navigation.navigate("CameraCapture")}
        >
          <Text style={styles.primaryButtonText}>Scan New Document</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Quick Actions</Text>
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionCard} activeOpacity={0.85} onPress={() => navigation.navigate("CameraCapture")}>
          <Text style={styles.actionIcon}>+ </Text>
          <Text style={styles.actionTitle}>New Scan</Text>
          <Text style={styles.actionText}>Open camera scanner</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionCard} activeOpacity={0.85} onPress={handleUpload}>
          <Text style={styles.actionIcon}>[ ] </Text>
          <Text style={styles.actionTitle}>Import File</Text>
          <Text style={styles.actionText}>{isPickingFile ? "Opening picker..." : "Use existing image/PDF"}</Text>
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

function CameraCaptureScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef(null);

  const handleCapture = async () => {
    if (!cameraRef.current || isCapturing) {
      return;
    }

    try {
      setIsCapturing(true);
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      navigation.navigate("ScanPreview", {
        doc: {
          uri: photo.uri,
          name: `Scan_${Date.now()}.jpg`,
          mimeType: "image/jpeg",
          size: undefined,
          source: "Camera",
        },
      });
    } catch (error) {
      Alert.alert("Capture failed", "Unable to capture photo. Please try again.");
    } finally {
      setIsCapturing(false);
    }
  };

  if (!permission) {
    return (
      <View style={styles.cameraStateContainer}>
        <Text style={styles.cameraStateText}>Loading camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.cameraStateContainer}>
        <Text style={styles.cameraStateText}>Camera access is required to scan documents.</Text>
        <TouchableOpacity style={styles.primaryButtonSolid} activeOpacity={0.85} onPress={requestPermission}>
          <Text style={styles.primaryButtonSolidText}>Allow Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.cameraScreen}>
      <CameraView ref={cameraRef} style={styles.cameraView} facing="back" />
      <View style={styles.cameraActionBar}>
        <TouchableOpacity style={styles.cameraCaptureButton} activeOpacity={0.85} onPress={handleCapture}>
          <Ionicons name={isCapturing ? "hourglass-outline" : "camera"} size={24} color="#FFFFFF" />
          <Text style={styles.cameraCaptureText}>{isCapturing ? "Capturing..." : "Capture"}</Text>
        </TouchableOpacity>
      </View>
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

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

function openNotificationResult(data) {
  if (!navigationRef.isReady() || !data?.jobId) return;
  navigationRef.navigate("Main", {
    screen: "Converter",
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
        screenOptions={{
          headerShown: false,
          tabBarStyle: [styles.tabBar, { backgroundColor: colors.tabBar, borderTopColor: colors.border }],
          tabBarLabelStyle: styles.tabLabel,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
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
          name="Converter"
          component={ConverterStack}
          options={{
            tabBarIcon: ({ color, size }) => <Ionicons name="swap-horizontal" size={size} color={color} />,
          }}
        />
        <Tab.Screen
          name="History"
          component={HistoryScreen}
          options={{
            tabBarIcon: ({ color, size }) => <Ionicons name="time" size={size} color={color} />,
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            headerShown: true,
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.text,
            title: "Profile",
            tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
          }}
        />
      </Tab.Navigator>
    </>
  );
}

export default function App() {
  useEffect(() => {
    registerBackgroundConversionTasks().catch(() => {});
    registerForPushNotifications().catch(() => {});
    const subscription = addNotificationResponseListener(openNotificationResult);
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider>
      <NavigationContainer ref={navigationRef}>
        <RootNavigator AuthenticatedComponent={RootTabs} />
      </NavigationContainer>
    </ThemeProvider>
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
  cameraScreen: {
    flex: 1,
    backgroundColor: "#0F172A",
  },
  cameraView: {
    flex: 1,
  },
  cameraActionBar: {
    padding: 20,
    backgroundColor: "#0F172A",
  },
  cameraCaptureButton: {
    borderRadius: 14,
    backgroundColor: "#1D4ED8",
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  cameraCaptureText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 16,
  },
  cameraStateContainer: {
    flex: 1,
    backgroundColor: "#F4F6FA",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    gap: 14,
  },
  cameraStateText: {
    color: "#334155",
    fontSize: 15,
    textAlign: "center",
  },
});

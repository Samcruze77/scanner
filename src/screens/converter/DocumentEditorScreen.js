import React, { useRef, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  Dimensions,
  Alert,
  ActivityIndicator,
} from "react-native";
import {
  Canvas,
  Path,
  Skia,
  TouchInfo,
  useTouchHandler,
} from "@shopify/react-native-skia";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeContext";
import { getApiBaseUrl, uploadFile } from "../../services/api";
import { getToken } from "../../services/authApi";

const { width, height } = Dimensions.get("window");

export default function DocumentEditorScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { fileUri, fileName } = route.params || {};
  
  const [tool, setTool] = useState("pen"); // pen, highlighter, text
  const [paths, setPaths] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [loading, setLoading] = useState(false);

  // Use a ref to keep track of paths for the touch handler to avoid stale closures
  const pathsRef = useRef([]);

  const onTouch = useTouchHandler({
    onStart: (touch) => {
      const newPath = Skia.Path.Make();
      newPath.moveTo(touch.x, touch.y);
      
      const pathObj = {
        path: newPath,
        color: tool === "highlighter" ? "rgba(255, 255, 0, 0.4)" : "#000",
        strokeWidth: tool === "highlighter" ? 20 : 3,
        type: tool,
      };
      
      pathsRef.current.push(pathObj);
      setPaths([...pathsRef.current]);
      setRedoStack([]);
    },
    onActive: (touch) => {
      const lastPathObj = pathsRef.current[pathsRef.current.length - 1];
      if (lastPathObj) {
        lastPathObj.path.lineTo(touch.x, touch.y);
        setPaths([...pathsRef.current]);
      }
    },
  }, [tool]);

  const handleUndo = () => {
    if (paths.length === 0) return;
    const last = pathsRef.current.pop();
    setRedoStack((prev) => [...prev, last]);
    setPaths([...pathsRef.current]);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const last = redoStack[redoStack.length - 1];
    pathsRef.current.push(last);
    setPaths([...pathsRef.current]);
    setRedoStack((prev) => prev.slice(0, -1));
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      
      // Use the new cross-platform uploadFile utility
      const result = await uploadFile(
        fileUri,
        `${getApiBaseUrl()}/documents/upload?filename=${encodeURIComponent(`edited_${fileName || "doc.pdf"}`)}&annotations=${paths.length}`,
        token
      );

      Alert.alert("Success", "Document saved successfully!");
      navigation.goBack();
    } catch (error) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Toolbar */}
      <View style={[styles.toolbar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.toolBtn, tool === "pen" && { backgroundColor: colors.primary + "20" }]} 
          onPress={() => setTool("pen")}
        >
          <Ionicons name="pencil" size={24} color={tool === "pen" ? colors.primary : colors.text} />
          <Text style={[styles.toolLabel, { color: tool === "pen" ? colors.primary : colors.text }]}>Pen</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.toolBtn, tool === "highlighter" && { backgroundColor: colors.primary + "20" }]} 
          onPress={() => setTool("highlighter")}
        >
          <Ionicons name="brush" size={24} color={tool === "highlighter" ? colors.primary : colors.text} />
          <Text style={[styles.toolLabel, { color: tool === "highlighter" ? colors.primary : colors.text }]}>Highlight</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.toolBtn, tool === "text" && { backgroundColor: colors.primary + "20" }]} 
          onPress={() => setTool("text")}
        >
          <Ionicons name="text" size={24} color={tool === "text" ? colors.primary : colors.text} />
          <Text style={[styles.toolLabel, { color: tool === "text" ? colors.primary : colors.text }]}>Text</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.toolBtn} 
          onPress={() => navigation.navigate("Signature", { fileUri, fileName })}
        >
          <Ionicons name="create-outline" size={24} color={colors.text} />
          <Text style={[styles.toolLabel, { color: colors.text }]}>Sign</Text>
        </TouchableOpacity>
      </View>

      {/* Undo/Redo */}
      <View style={styles.historyBar}>
        <TouchableOpacity onPress={handleUndo} disabled={paths.length === 0}>
          <Ionicons name="arrow-undo" size={28} color={paths.length === 0 ? colors.textMuted : colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleRedo} disabled={redoStack.length === 0}>
          <Ionicons name="arrow-redo" size={28} color={redoStack.length === 0 ? colors.textMuted : colors.text} />
        </TouchableOpacity>
      </View>

      {/* Document Preview / Canvas */}
      <View style={[styles.canvasContainer, { borderColor: colors.border }]}>
        <Canvas style={styles.canvas} onTouch={onTouch}>
          {paths.map((p, index) => (
            <Path
              key={index}
              path={p.path}
              color={p.color}
              style="stroke"
              strokeWidth={p.strokeWidth}
              strokeCap="round"
              strokeJoin="round"
            />
          ))}
        </Canvas>
      </View>

      {/* Save Button */}
      <TouchableOpacity 
        style={[styles.saveBtn, { backgroundColor: colors.primary }]} 
        onPress={handleSave}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Save Document</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  toolBtn: {
    alignItems: "center",
    padding: 8,
    borderRadius: 8,
    minWidth: 70,
  },
  toolLabel: {
    fontSize: 10,
    marginTop: 4,
    fontWeight: "600",
  },
  historyBar: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 30,
    paddingVertical: 10,
  },
  canvasContainer: {
    flex: 1,
    margin: 15,
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#FFF",
  },
  canvas: {
    flex: 1,
  },
  saveBtn: {
    margin: 20,
    height: 55,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  saveBtnText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "700",
  },
});

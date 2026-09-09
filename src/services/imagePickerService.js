import * as ImagePicker from "expo-image-picker";

/**
 * Launches the image library to pick an image.
 * @returns {Promise<string|null>} The URI of the picked image or null if canceled.
 */
export async function pickImage() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: 1,
  });

  if (result.canceled) return null;

  return result.assets[0].uri;
}

import * as ImageManipulator from "expo-image-manipulator";

/**
 * Manipulates an image using Expo ImageManipulator.
 * @param {string} uri The URI of the image to manipulate.
 * @returns {Promise<object>} The result of the manipulation.
 */
export async function cropImage(uri) {
  return await ImageManipulator.manipulateAsync(uri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });
}

/**
 * Compatibility wrapper for the existing codebase that uses cropImageDocument.
 * @param {object} doc The document object containing the image URI.
 * @returns {Promise<object>} The updated document object.
 */
export async function cropImageDocument(doc) {
  if (!doc?.uri || !doc.mimeType?.startsWith("image/")) {
    return doc;
  }

  try {
    const result = await cropImage(doc.uri);
    return {
      ...doc,
      uri: result.uri,
      // expo-image-manipulator doesn't return size/name, so we keep original or infer if needed
    };
  } catch (error) {
    console.error("Image manipulation error:", error);
    return doc;
  }
}

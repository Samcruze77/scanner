// Maps internal error reason codes (from getUserMedia DOMException names,
// upload validation, or PDF generation) to short user-facing copy. Keep
// these generic -- they're also what gets passed to trackError as the
// analytics reason, so nothing sensitive belongs in the codes themselves.

const CAMERA_ERROR_MESSAGES: Record<string, string> = {
  NotAllowedError: "Camera access was denied. You can upload a photo instead.",
  NotFoundError: "No camera was found on this device. You can upload a photo instead.",
  NotReadableError: "The camera is already in use by another app. You can upload a photo instead.",
  OverconstrainedError: "This device's camera doesn't support the requested mode. You can upload a photo instead.",
  unsupported: "Camera scanning isn't supported in this browser. You can upload a photo instead.",
};

export function cameraErrorMessage(reason: string): string {
  return CAMERA_ERROR_MESSAGES[reason] ?? "Couldn't start the camera. You can upload a photo instead.";
}

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  unsupported_file_type: "That file type isn't supported. Please upload a photo (JPG, PNG, etc.).",
  file_too_large: "That file is too large. Please use an image under 25MB.",
  image_decode_failed: "That image couldn't be read. Try a different file.",
};

export function uploadErrorMessage(reason: string): string {
  return UPLOAD_ERROR_MESSAGES[reason] ?? "That file couldn't be uploaded.";
}

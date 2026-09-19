const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export type UploadValidationError = "unsupported_file_type" | "file_too_large";

export function validateImageFile(file: File): UploadValidationError | null {
  if (!file.type.startsWith("image/")) return "unsupported_file_type";
  if (file.size > MAX_FILE_SIZE_BYTES) return "file_too_large";
  return null;
}

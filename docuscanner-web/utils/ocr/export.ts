"use client";

// Everything here runs locally; extracted text is never uploaded.

import { downloadBlob } from "@/utils/convert/download";

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API can be unavailable (insecure context) or denied; fall back
    // to the legacy selection-based copy.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

export function downloadTextFile(text: string, filename: string): void {
  // Same save-as-file behaviour as every other download in the app (a text
  // blob would otherwise open in a tab on some browsers). The bytes stay UTF-8.
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

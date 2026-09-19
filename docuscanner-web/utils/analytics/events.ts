"use client";

// Convenience wrappers over trackEvent() for each product event. Import
// these from the scan/upload/conversion/download UI once it's built --
// nothing in the app calls most of these yet (that UI doesn't exist in
// docuscanner-web currently). Keep properties small and non-sensitive:
// never pass document contents, file bytes, or extracted text.

import { trackEvent } from "./client";

export function trackPageView() {
  return trackEvent("page_view");
}

export function trackAppOpen() {
  return trackEvent("app_open");
}

export function trackSignupStarted(method?: string) {
  return trackEvent("signup_started", { properties: { method } });
}

export function trackSignupCompleted(method?: string) {
  return trackEvent("signup_completed", { properties: { method } });
}

export function trackLogin(method?: string) {
  return trackEvent("login", { properties: { method } });
}

export function trackLogout() {
  return trackEvent("logout");
}

export function trackScanStarted(source?: "camera" | "upload") {
  return trackEvent("scan_started", { properties: { source } });
}

export function trackScanCompleted(pageCount?: number) {
  return trackEvent("scan_completed", { properties: { pageCount } });
}

export function trackDocumentUploaded(mimeType?: string, fileSizeBytes?: number) {
  return trackEvent("document_uploaded", { properties: { mimeType, fileSizeBytes } });
}

export function trackDocumentCreated(pageCount?: number) {
  return trackEvent("document_created", { properties: { pageCount } });
}

export function trackConversionStarted(conversionType: string) {
  return trackEvent("conversion_started", { conversionType });
}

export function trackConversionCompleted(conversionType: string, durationMs?: number) {
  return trackEvent("conversion_completed", { conversionType, properties: { durationMs } });
}

export function trackDocumentDownloaded(format?: string) {
  return trackEvent("document_downloaded", { properties: { format } });
}

// `properties` is for small, non-sensitive context only (counts, enums) --
// never document contents, extracted text, filenames, or storage paths.
export function trackFeatureUsed(feature: string, properties?: Record<string, unknown>) {
  return trackEvent("feature_used", { properties: { ...properties, feature } });
}

export function trackError(context: string, message?: string) {
  return trackEvent("error", { properties: { context, message } });
}

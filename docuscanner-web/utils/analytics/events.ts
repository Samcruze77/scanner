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

// ---- Tools menu ----------------------------------------------------------------
//
// The deployed `track-analytics` function only accepts the event names in
// client.ts, so the product events below ride on the existing ones, told apart
// by their `feature` / `conversion_type`. Nothing here ever carries a document,
// filename, OCR text or signature image: only tool ids, enums, sizes and counts.

// tool_opened
export function trackToolOpened(tool: string) {
  return trackFeatureUsed("tool_opened", { tool });
}

// login_required: a guest reached a tool that asks for a (free) account.
export function trackLoginRequired(tool: string) {
  return trackFeatureUsed("login_required", { tool });
}

// password_reset_requested / password_reset_completed: the forgot-password flow.
// Only the fact that it happened: never the email address, the link or any
// password (see utils/auth/messages.ts for the error codes that are safe to send).
export function trackPasswordResetRequested() {
  return trackFeatureUsed("password_reset_requested");
}

export function trackPasswordResetCompleted() {
  return trackFeatureUsed("password_reset_completed");
}

// print: the person asked to print (the browser's print dialog was requested).
// `source` is where it was started (scan | editor_page | convert | compress |
// history). Never carries the document, its name, or any printer information.
export function trackPrint(source: string, pageCount: number) {
  return trackFeatureUsed("print", { source, pageCount });
}

// compression_started / compression_completed / compression_failed. `kind` is
// pdf | image | word | excel; the reduction is a whole-number percentage. `level`
// is the slider step (low | balanced | medium | high | maximum), or "target" /
// "flatten" when the level was picked by a size target or the PDF page redraw.
export function trackCompressionStarted(kind: string, level?: string) {
  return trackEvent("conversion_started", { conversionType: `compress_${kind}`, properties: { level } });
}

export function trackCompressionCompleted(kind: string, durationMs: number, reductionPct: number, targetMet: boolean | null, level?: string) {
  return trackEvent("conversion_completed", {
    conversionType: `compress_${kind}`,
    properties: { durationMs, reductionPct: Math.round(reductionPct), targetMet, level },
  });
}

export function trackCompressionFailed(kind: string, code: string) {
  return trackError(`compress_${kind}`, code);
}

// signature_drawn / signature_uploaded (and typed): which method, never the image.
export function trackSignatureAdded(method: "draw" | "upload" | "type") {
  return trackFeatureUsed(method === "draw" ? "signature_drawn" : method === "upload" ? "signature_uploaded" : "signature_typed");
}

// sign_pdf: a PDF was created that carries at least one signature.
export function trackSignPdf(signatureCount: number) {
  return trackFeatureUsed("sign_pdf", { signatureCount });
}

// Advertising. Only called for a live ad provider (see utils/ads/config.ts);
// placeholders are never counted. Placement is a fixed enum, nothing else.
export function trackAdImpression(placement: string, provider: string) {
  return trackFeatureUsed("ad_impression", { placement, provider });
}

export function trackAdClick(placement: string, provider: string) {
  return trackFeatureUsed("ad_click", { placement, provider });
}

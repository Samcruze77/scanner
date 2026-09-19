// Single place that decides which product capabilities a user can use. The UI
// asks `isFeatureAvailable(...)` instead of checking plans or flags itself, so
// activating Premium later is a change here (plus a real plan lookup in
// getUserPlan), not a hunt through components.
//
// Premium is NOT active. Every user is on "free", and any feature that needs
// a higher plan stays unavailable until PREMIUM_ENABLED is flipped.

import type { User } from "@supabase/supabase-js";

export type PlanId = "free" | "premium";

export type FeatureId =
  | "convert.excel_to_pdf"
  | "convert.pdf_to_excel"
  | "convert.word_to_pdf"
  | "convert.pdf_to_word"
  | "ocr.basic"
  | "ocr.advanced"
  | "ocr.batch"
  | "ocr.table_extraction"
  | "ai.document_understanding";

interface FeatureDefinition {
  // Lowest plan that includes the feature.
  minPlan: PlanId;
  // False until the capability is actually built, regardless of plan.
  implemented: boolean;
}

export const PREMIUM_ENABLED = false;

export const FEATURES: Record<FeatureId, FeatureDefinition> = {
  // Free: both run entirely in the browser (no server cost, files never leave
  // the device). PDF -> Excel reads digital PDFs with real columns; scanned
  // pages go through basic OCR and come out one line per row. Column detection
  // for scanned tables stays reserved as `ocr.table_extraction` below.
  "convert.excel_to_pdf": { minPlan: "free", implemented: true },
  "convert.pdf_to_excel": { minPlan: "free", implemented: true },
  // Word conversions also run entirely in the browser and stay free.
  "convert.word_to_pdf": { minPlan: "free", implemented: true },
  "convert.pdf_to_word": { minPlan: "free", implemented: true },
  // Free at launch: in-browser Tesseract, English, page-by-page.
  "ocr.basic": { minPlan: "free", implemented: true },
  // Reserved for the paid tier (~6-8 months post launch): higher-accuracy
  // models, more languages, layout-aware output.
  "ocr.advanced": { minPlan: "premium", implemented: false },
  "ocr.batch": { minPlan: "premium", implemented: false },
  "ocr.table_extraction": { minPlan: "premium", implemented: false },
  "ai.document_understanding": { minPlan: "premium", implemented: false },
};

// Every user is "free" until billing exists. This is UI gating only -- any
// future server-side paid capability must verify entitlement on the server.
export function getUserPlan(user: User | null): PlanId {
  void user;
  return "free";
}

export function isFeatureAvailable(feature: FeatureId, plan: PlanId): boolean {
  const definition = FEATURES[feature];
  if (!definition.implemented) return false;
  if (definition.minPlan === "free") return true;
  return PREMIUM_ENABLED && plan === "premium";
}

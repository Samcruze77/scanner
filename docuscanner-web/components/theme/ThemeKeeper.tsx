"use client";

import { useLayoutEffect } from "react";
import { keepThemeApplied } from "./theme";

// Mounted once in the root layout (the theme menu is not on every screen). Renders nothing;
// keeps the chosen theme on <html> if React ever resets that element (see keepThemeApplied).
export function ThemeKeeper() {
  useLayoutEffect(() => keepThemeApplied(), []);
  return null;
}

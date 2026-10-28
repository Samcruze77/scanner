// Lets Node import the app's TypeScript modules (relative imports without extensions, and the "@/" alias) in tests.
import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const target = path.join(ROOT, specifier.slice(2));
    return next(pathToFileURL(/\.(ts|tsx|mjs|js)$/.test(target) ? target : target + ".ts").href, context);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    try {
      return await next(specifier, context);
    } catch (e) {
      if (!/\.(ts|tsx|mjs|js)$/.test(specifier)) return next(specifier + ".ts", context);
      throw e;
    }
  }
  return next(specifier, context);
}

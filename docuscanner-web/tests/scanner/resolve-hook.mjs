// Lets Node import the app's TypeScript modules (relative imports without extensions) in tests.
export async function resolve(specifier, context, next) {
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

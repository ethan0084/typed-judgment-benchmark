/**
 * Loader hook for CLI scripts.
 *
 * Maps the `server-only` guard to its server build (the CLI *is* server-side)
 * and resolves the `@/` path alias that tsconfig defines for the app.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();

export function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return next(
      pathToFileURL(path.join(root, "node_modules/server-only/empty.js")).href,
      context,
    );
  }
  if (specifier.startsWith("@/")) {
    return next(pathToFileURL(path.join(root, "src", specifier.slice(2))).href, context);
  }
  return next(specifier, context);
}

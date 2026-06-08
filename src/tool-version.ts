import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The version of the running cerebro, read once from the package manifest.
 * Recorded on a Scan result as `toolVersion` so a consumer can tell which
 * cerebro produced a persisted result and treat one from a different version
 * as a stale cache to be re-derived.
 */
export const TOOL_VERSION: string = readToolVersion();

/**
 * Reads the cerebro version from the package manifest one level above this
 * module — `src/` in development, `dist/` once bundled, both of which sit
 * beside `package.json`.
 *
 * @returns The manifest `version`, or `"0.0.0"` when it cannot be read.
 */
function readToolVersion(): string {
  try {
    const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

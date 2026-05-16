import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isObject } from "./ast-guards.js";

const FIGMA_CONFIG_FILENAME = "figma.config.json";

/**
 * Reads the `documentUrlSubstitutions` map from `figma.config.json` at the
 * project root. Code Connect lets a `figma.connect()` URL be written as a
 * placeholder (e.g. `<FIGMA_BUTTON>`) that this map expands into a real URL.
 *
 * The config file is optional: a missing file yields an empty map silently.
 * An unreadable file or invalid JSON yields an empty map and a warning. Only
 * the string-to-string entries under `codeConnect.documentUrlSubstitutions`
 * are kept; any other shape is ignored without a warning.
 *
 * @param cwd - The project root directory.
 * @param warnings - Mutable accumulator for non-fatal warnings.
 * @returns The substitution map, keyed by placeholder.
 */
export function readDocumentUrlSubstitutions(
  cwd: string,
  warnings: string[],
): Record<string, string> {
  const configPath = join(cwd, FIGMA_CONFIG_FILENAME);
  if (!existsSync(configPath)) return {};

  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (err) {
    warnings.push(`failed to read ${FIGMA_CONFIG_FILENAME}: ${(err as Error).message}`);
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    warnings.push(`failed to parse ${FIGMA_CONFIG_FILENAME}: ${(err as Error).message}`);
    return {};
  }

  const codeConnect = isObject(parsed)
    ? (parsed as Record<string, unknown>).codeConnect
    : undefined;
  const documentUrlSubstitutions = isObject(codeConnect)
    ? (codeConnect as Record<string, unknown>).documentUrlSubstitutions
    : undefined;
  if (!isObject(documentUrlSubstitutions)) return {};

  const substitutions: Record<string, string> = {};
  for (const [placeholder, value] of Object.entries(documentUrlSubstitutions)) {
    if (typeof value === "string") substitutions[placeholder] = value;
  }
  return substitutions;
}

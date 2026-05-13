import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseBarrel } from "./barrel.js";
import { CONFIG_FILENAME } from "./init.js";
import { toPosixPath } from "./paths.js";

export interface ScanOptions {
  cwd: string;
}

export interface ScannedComponent {
  name: string;
  path: string;
}

export interface ScanResult {
  components: ScannedComponent[];
  warnings: string[];
}

const BARREL_BASENAMES = ["index.ts", "index.tsx"];
const SOURCE_RESOLUTION_EXTS = [".tsx", ".ts"];

/**
 * Reads the project config and scans the design system's components root,
 * extracting the list of public Components from the barrel index file.
 *
 * @param options - The scan options.
 * @param options.cwd - The project root directory.
 * @returns The alphabetically-sorted list of Components with their source
 *   paths relative to `cwd`, plus any non-fatal warnings produced during the
 *   scan.
 * @throws If the config is missing, invalid, or points to a non-existent
 *   components root, or if no barrel index file is found.
 */
export function scan({ cwd }: ScanOptions): ScanResult {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  let configText: string;
  try {
    configText = readFileSync(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No ${CONFIG_FILENAME} found. Run "cerebro init" first.`);
    }
    throw err;
  }

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(configText);
  } catch (err) {
    throw new Error(`Failed to parse ${CONFIG_FILENAME}: ${(err as Error).message}`);
  }

  if (
    typeof rawConfig !== "object" ||
    rawConfig === null ||
    typeof (rawConfig as { componentsPath?: unknown }).componentsPath !== "string"
  ) {
    throw new Error(`${CONFIG_FILENAME} is missing a valid "componentsPath" field.`);
  }
  const componentsPathRel = (rawConfig as { componentsPath: string }).componentsPath;

  const componentsRoot = resolve(cwd, componentsPathRel);
  const rootStat = statSync(componentsRoot, { throwIfNoEntry: false });
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`componentsPath "${componentsPathRel}" does not exist or is not a directory.`);
  }

  let barrelPath: string | null = null;
  for (const name of BARREL_BASENAMES) {
    const candidate = join(componentsRoot, name);
    if (existsSync(candidate)) {
      barrelPath = candidate;
      break;
    }
  }
  if (barrelPath === null) {
    throw new Error(
      `No barrel file found at "${componentsPathRel}/index.ts" or "${componentsPathRel}/index.tsx".`,
    );
  }

  const sourceText = readFileSync(barrelPath, "utf8");
  const parsed = parseBarrel(sourceText, barrelPath);

  const warnings: string[] = [];
  for (const w of parsed.warnings) {
    if (w.code === "wildcard-export") {
      warnings.push(`skipped wildcard export "${w.detail}" (not supported in v1)`);
    } else if (w.code === "default-export") {
      warnings.push("skipped default export of the barrel (not supported in v1)");
    }
  }

  const barrelDir = dirname(barrelPath);
  const components: ScannedComponent[] = [];

  for (const exp of parsed.exports) {
    let absolutePath: string;
    if (exp.source === null) {
      absolutePath = barrelPath;
    } else {
      const resolved = resolveSourcePath(barrelDir, exp.source);
      if (resolved === null) {
        warnings.push(`skipped export "${exp.name}": could not resolve "${exp.source}"`);
        continue;
      }
      absolutePath = resolved;
    }
    const rel = toPosixPath(relative(cwd, absolutePath));
    components.push({ name: exp.name, path: rel });
  }

  components.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Only flag the barrel as silent when it has neither named exports nor any
  // unsupported shapes — wildcard/default warnings already explain emptiness.
  if (parsed.exports.length === 0 && parsed.warnings.length === 0) {
    const barrelRel = toPosixPath(relative(cwd, barrelPath));
    warnings.push(`barrel "${barrelRel}" has no named exports`);
  }

  return { components, warnings };
}

function resolveSourcePath(barrelDir: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = isAbsolute(specifier) ? specifier : resolve(barrelDir, specifier);

  for (const ext of SOURCE_RESOLUTION_EXTS) {
    const candidate = `${base}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const ext of SOURCE_RESOLUTION_EXTS) {
    const candidate = join(base, `index${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

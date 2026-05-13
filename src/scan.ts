import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseBarrel } from "./barrel.js";
import { CONFIG_FILENAME } from "./init.js";
import { toPosixPath } from "./paths.js";
import { type TestCounts, countTests } from "./tests-counter.js";

export interface ScanOptions {
  cwd: string;
}

export interface ScannedComponent {
  name: string;
  path: string;
  tests: TestCounts;
}

export interface ScanResult {
  components: ScannedComponent[];
  warnings: string[];
}

const BARREL_BASENAMES = ["index.ts", "index.tsx"];
const SOURCE_RESOLUTION_EXTS = [".tsx", ".ts"];
const TEST_SUFFIXES = [".test.tsx", ".test.ts", ".spec.tsx", ".spec.ts"];
const ZERO_TESTS: TestCounts = { total: 0, skipped: 0, only: 0 };

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

  const configText = ((): string => {
    try {
      return readFileSync(configPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`No ${CONFIG_FILENAME} found. Run "cerebro init" first.`);
      }
      throw err;
    }
  })();

  const rawConfig = ((): unknown => {
    try {
      return JSON.parse(configText);
    } catch (err) {
      throw new Error(`Failed to parse ${CONFIG_FILENAME}: ${(err as Error).message}`);
    }
  })();

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

  const barrelPath = findExistingFile(BARREL_BASENAMES.map((name) => join(componentsRoot, name)));
  if (barrelPath === null) {
    throw new Error(
      `No barrel file found at "${componentsPathRel}/index.ts" or "${componentsPathRel}/index.tsx".`,
    );
  }

  const sourceText = readFileSync(barrelPath, "utf8");
  const parsed = parseBarrel(sourceText, barrelPath);

  const parseWarnings = parsed.warnings.map((w) =>
    w.code === "wildcard-export"
      ? `skipped wildcard export "${w.detail}" (not supported in v1)`
      : "skipped default export of the barrel (not supported in v1)",
  );

  const barrelDir = dirname(barrelPath);
  const warnings: string[] = [...parseWarnings];

  const components = parsed.exports.flatMap((exp): ScannedComponent[] => {
    const isBarrelLocal = exp.source === null;
    const absolutePath = isBarrelLocal
      ? barrelPath
      : resolveSourcePath(barrelDir, exp.source as string, exp.importedName);

    if (absolutePath === null) {
      warnings.push(`skipped export "${exp.name}": could not resolve "${exp.source}"`);
      return [];
    }

    const rel = toPosixPath(relative(cwd, absolutePath));
    const tests = isBarrelLocal ? ZERO_TESTS : countTestsForComponent(absolutePath, warnings, cwd);

    return [{ name: exp.name, path: rel, tests }];
  });

  const sortedComponents = components.toSorted((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );

  // Only flag the barrel as silent when it has neither named exports nor any
  // unsupported shapes — wildcard/default warnings already explain emptiness.
  if (parsed.exports.length === 0 && parsed.warnings.length === 0) {
    const barrelRel = toPosixPath(relative(cwd, barrelPath));
    warnings.push(`barrel "${barrelRel}" has no named exports`);
  }

  return { components: sortedComponents, warnings };
}

function resolveSourcePath(
  barrelDir: string,
  specifier: string,
  importedName: string | null,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = isAbsolute(specifier) ? specifier : resolve(barrelDir, specifier);

  const directFile = findExistingFile(SOURCE_RESOLUTION_EXTS.map((ext) => `${base}${ext}`));
  if (directFile !== null) return directFile;

  if (!statSync(base, { throwIfNoEntry: false })?.isDirectory()) return null;

  // When the folder holds several sibling files (e.g. FancySelect/ contains both
  // FancySelect.tsx and FancyAsyncSelect.tsx), the imported name disambiguates
  // which file is the source of THIS export.
  if (importedName !== null) {
    const named = findExistingFile(
      SOURCE_RESOLUTION_EXTS.map((ext) => join(base, `${importedName}${ext}`)),
    );
    if (named !== null) return named;
  }

  // Prefer `X/X.tsx` over `X/index.tsx`: the folder-named file is the canonical
  // Component source in most React DS conventions; `index.ts` is usually an
  // inner barrel that just re-exports it.
  const folderName = basename(base);
  const folderNamed = findExistingFile(
    SOURCE_RESOLUTION_EXTS.map((ext) => join(base, `${folderName}${ext}`)),
  );
  if (folderNamed !== null) return folderNamed;

  return findExistingFile(SOURCE_RESOLUTION_EXTS.map((ext) => join(base, `index${ext}`)));
}

function findExistingFile(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function testFileCandidates(componentSource: string): string[] {
  const dir = dirname(componentSource);
  const base = basename(componentSource, extname(componentSource));
  const colocated = TEST_SUFFIXES.map((suffix) => join(dir, `${base}${suffix}`));
  const subfolder = TEST_SUFFIXES.map((suffix) => join(dir, "__tests__", `${base}${suffix}`));

  return [...colocated, ...subfolder];
}

function countTestsForComponent(
  componentSource: string,
  warnings: string[],
  cwd: string,
): TestCounts {
  return testFileCandidates(componentSource).reduce<TestCounts>((acc, candidate) => {
    if (!existsSync(candidate)) return acc;

    const text = ((): string | null => {
      try {
        return readFileSync(candidate, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        const rel = toPosixPath(relative(cwd, candidate));
        warnings.push(`failed to read test file "${rel}": ${(err as Error).message}`);
        return null;
      }
    })();

    if (text === null) return acc;

    try {
      const counts = countTests(text, candidate);
      return {
        total: acc.total + counts.total,
        skipped: acc.skipped + counts.skipped,
        only: acc.only + counts.only,
      };
    } catch (err) {
      const rel = toPosixPath(relative(cwd, candidate));
      warnings.push(`failed to parse test file "${rel}": ${(err as Error).message}`);
      return acc;
    }
  }, ZERO_TESTS);
}

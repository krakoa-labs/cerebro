import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type ParsedExport, parseBarrel } from "./barrel.js";
import { type DeprecationLookup, detectDeprecation } from "./deprecation-detector.js";
import { CONFIG_FILENAME } from "./init.js";
import { toPosixPath } from "./paths.js";
import { type StoryBreakdown, ZERO_STORIES, analyzeStories } from "./stories-counter.js";
import { type TestCounts, countTests } from "./tests-counter.js";

export interface ScanOptions {
  cwd: string;
}

export interface ScannedComponent {
  name: string;
  path: string;
  tests: TestCounts;
  stories?: StoryBreakdown;
  deprecated: boolean;
}

export interface ScanResult {
  components: ScannedComponent[];
  warnings: string[];
}

const BARREL_BASENAMES = ["index.ts", "index.tsx"];
const SOURCE_RESOLUTION_EXTS = [".tsx", ".ts"];
const TEST_SUFFIXES = [".test.tsx", ".test.ts", ".spec.tsx", ".spec.ts"];
const STORY_SUFFIXES = [".stories.tsx", ".stories.ts"];
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

  const { componentsPath: componentsPathRel, usesStorybook } = validateConfig(rawConfig);

  const componentsRoot = resolve(cwd, componentsPathRel);
  const rootStat = statSync(componentsRoot, { throwIfNoEntry: false });
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`componentsPath "${componentsPathRel}" does not exist or is not a directory.`);
  }

  const realRoot = realpathSync(componentsRoot);
  const realCwd = realpathSync(cwd);
  if (realRoot !== realCwd && !realRoot.startsWith(realCwd + sep)) {
    throw new Error(
      `componentsPath "${componentsPathRel}" resolves outside the project root via symlink.`,
    );
  }

  const barrelPath = findExistingFile(BARREL_BASENAMES.map((name) => join(componentsRoot, name)));
  if (barrelPath === null) {
    throw new Error(
      `No barrel file found at "${componentsPathRel}/index.ts" or "${componentsPathRel}/index.tsx".`,
    );
  }

  const sourceText = readFileSync(barrelPath, "utf8");
  const barrelRel = toPosixPath(relative(cwd, barrelPath));
  const parsed = parseBarrel(sourceText, barrelRel);

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
    const deprecated = deprecationOf(absolutePath, exp, warnings, cwd);

    if (!usesStorybook) return [{ name: exp.name, path: rel, tests, deprecated }];

    const stories = isBarrelLocal
      ? ZERO_STORIES
      : analyzeStoriesForComponent(absolutePath, warnings, cwd);

    return [{ name: exp.name, path: rel, tests, stories, deprecated }];
  });

  const sortedComponents = components.toSorted((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );

  // Only flag the barrel as silent when it has neither named exports nor any
  // unsupported shapes — wildcard/default warnings already explain emptiness.
  if (parsed.exports.length === 0 && parsed.warnings.length === 0) {
    warnings.push(`barrel "${barrelRel}" has no named exports`);
  }

  return { components: sortedComponents, warnings };
}

/**
 * Validates the raw JSON config payload and returns normalized scan settings.
 *
 * @param raw - The parsed JSON config value.
 * @returns The validated components path and Storybook flag.
 * @throws If the config shape is invalid.
 */
function validateConfig(raw: unknown): { componentsPath: string; usesStorybook: boolean } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${CONFIG_FILENAME} must contain a JSON object.`);
  }

  const cp = (raw as { componentsPath?: unknown }).componentsPath;
  if (cp === undefined) {
    throw new Error(`${CONFIG_FILENAME} is missing the "componentsPath" field.`);
  }
  if (typeof cp !== "string") {
    throw new Error(
      `${CONFIG_FILENAME} has an invalid "componentsPath" field: expected string, got ${typeof cp}.`,
    );
  }

  const usb = (raw as { usesStorybook?: unknown }).usesStorybook;
  if (usb !== undefined && typeof usb !== "boolean") {
    throw new Error(
      `${CONFIG_FILENAME} has an invalid "usesStorybook" field: expected boolean, got ${typeof usb}.`,
    );
  }

  return { componentsPath: cp, usesStorybook: usb === true };
}

/**
 * Resolves a barrel export source to the component source file it points at.
 *
 * @param barrelDir - Absolute directory containing the barrel file.
 * @param specifier - The export source specifier from the barrel.
 * @param importedName - The imported binding name, when available.
 * @returns The resolved source file path, or `null` when no supported source
 *   file can be found.
 */
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

/**
 * Finds the first existing file path in a candidate list.
 *
 * @param candidates - Absolute file paths to check in priority order.
 * @returns The first existing candidate, or `null` when none exist.
 */
function findExistingFile(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Builds the supported test-file candidates for a component source file.
 *
 * @param componentSource - Absolute path to the component source file.
 * @returns Co-located and `__tests__` candidate file paths.
 */
function testFileCandidates(componentSource: string): string[] {
  const dir = dirname(componentSource);
  const base = basename(componentSource, extname(componentSource));
  const colocated = TEST_SUFFIXES.map((suffix) => join(dir, `${base}${suffix}`));
  const subfolder = TEST_SUFFIXES.map((suffix) => join(dir, "__tests__", `${base}${suffix}`));

  return [...colocated, ...subfolder];
}

/**
 * Builds the supported story-file candidates for a component source file.
 *
 * @param componentSource - Absolute path to the component source file.
 * @returns Co-located Storybook candidate file paths.
 */
function storyFileCandidates(componentSource: string): string[] {
  const dir = dirname(componentSource);
  const base = basename(componentSource, extname(componentSource));

  return STORY_SUFFIXES.map((suffix) => join(dir, `${base}${suffix}`));
}

interface FoldOptions<T> {
  candidates: string[];
  zero: T;
  label: string;
  parse: (text: string, candidate: string) => T;
  merge: (acc: T, next: T) => T;
  warnings: string[];
  cwd: string;
}

/**
 * Folds a parsed-and-merged result over a list of candidate file paths.
 * Missing files are silently skipped; read or parse errors are recorded as
 * warnings (using `label` to compose the message) and the candidate is
 * skipped without aborting the fold.
 *
 * @param opts - The fold configuration.
 * @returns The merged result over all parseable candidate files.
 */
function foldOverCandidates<T>(opts: FoldOptions<T>): T {
  const { candidates, zero, label, parse, merge, warnings, cwd } = opts;
  return candidates.reduce<T>((acc, candidate) => {
    if (!existsSync(candidate)) return acc;

    const text = ((): string | null => {
      try {
        return readFileSync(candidate, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        const rel = toPosixPath(relative(cwd, candidate));
        warnings.push(`failed to read ${label} file "${rel}": ${(err as Error).message}`);
        return null;
      }
    })();

    if (text === null) return acc;

    try {
      return merge(acc, parse(text, candidate));
    } catch (err) {
      const rel = toPosixPath(relative(cwd, candidate));
      warnings.push(`failed to parse ${label} file "${rel}": ${(err as Error).message}`);
      return acc;
    }
  }, zero);
}

/**
 * Sums the CSF-generation breakdowns across every co-located stories file
 * (`*.stories.tsx`, `*.stories.ts`) found next to a Component's source file.
 *
 * @param componentSource - Absolute path to the Component's source file.
 * @param warnings - Mutable accumulator for non-fatal warnings raised during
 *   stories-file reads or parses.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns The summed `StoryBreakdown` across all co-located stories files,
 *   or an all-zero breakdown if no stories file exists.
 */
function analyzeStoriesForComponent(
  componentSource: string,
  warnings: string[],
  cwd: string,
): StoryBreakdown {
  return foldOverCandidates<StoryBreakdown>({
    candidates: storyFileCandidates(componentSource),
    zero: ZERO_STORIES,
    label: "stories",
    parse: analyzeStories,
    merge: sumStoryBreakdowns,
    warnings,
    cwd,
  });
}

/**
 * Sums two story breakdowns field by field.
 *
 * @param acc - The current accumulated story breakdown.
 * @param next - The next story breakdown to add.
 * @returns The combined story breakdown.
 */
function sumStoryBreakdowns(acc: StoryBreakdown, next: StoryBreakdown): StoryBreakdown {
  return {
    total: acc.total + next.total,
    csf1: acc.csf1 + next.csf1,
    csf2: acc.csf2 + next.csf2,
    csf3: acc.csf3 + next.csf3,
    other: acc.other + next.other,
  };
}

/**
 * Sums test counts across every supported test candidate for a component.
 *
 * @param componentSource - Absolute path to the Component's source file.
 * @param warnings - Mutable accumulator for non-fatal warnings raised during
 *   test-file reads or parses.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns The summed test counts, or all-zero counts if no test file exists.
 */
function countTestsForComponent(
  componentSource: string,
  warnings: string[],
  cwd: string,
): TestCounts {
  return foldOverCandidates<TestCounts>({
    candidates: testFileCandidates(componentSource),
    zero: ZERO_TESTS,
    label: "test",
    parse: countTests,
    merge: sumTestCounts,
    warnings,
    cwd,
  });
}

/**
 * Sums two test-count objects field by field.
 *
 * @param acc - The current accumulated test counts.
 * @param next - The next test counts to add.
 * @returns The combined test counts.
 */
function sumTestCounts(acc: TestCounts, next: TestCounts): TestCounts {
  return {
    total: acc.total + next.total,
    skipped: acc.skipped + next.skipped,
    only: acc.only + next.only,
  };
}

/**
 * Computes the deprecation flag for a single Component by inspecting the
 * leading JSDoc on the declaration its barrel export resolves to. Read or
 * parse failures are recorded as warnings and the Component is reported as
 * non-deprecated. For barrel-local Components the file is the barrel itself;
 * the small redundant read is dominated by the parse cost the check incurs.
 *
 * @param absolutePath - Absolute path of the file containing the declaration.
 * @param exp - The barrel-parsed export, used to determine what to look up.
 * @param warnings - Mutable accumulator for non-fatal warnings.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns `true` when the resolved declaration carries a leading
 *   `@deprecated` JSDoc tag.
 */
function deprecationOf(
  absolutePath: string,
  exp: ParsedExport,
  warnings: string[],
  cwd: string,
): boolean {
  const text = readSourceForDeprecation(absolutePath, warnings, cwd);
  if (text === null) return false;

  try {
    return detectDeprecation(text, absolutePath, lookupFor(exp));
  } catch (err) {
    const rel = toPosixPath(relative(cwd, absolutePath));
    warnings.push(
      `failed to parse source "${rel}" for deprecation check: ${(err as Error).message}`,
    );
    return false;
  }
}

/**
 * Maps a barrel-parsed export to the lookup shape understood by the
 * deprecation detector. Barrel-local declarations and named re-exports both
 * resolve to a named lookup; `default`-shaped re-exports resolve to the
 * default-export lookup.
 *
 * Relies on the `barrel.ts` convention (see `importedNameOf`) that
 * `importedName === null` with a non-null `source` means a default
 * re-export — `export { default as Foo } from "./Foo"`.
 *
 * @param exp - The barrel-parsed export.
 * @returns The corresponding deprecation lookup.
 */
function lookupFor(exp: ParsedExport): DeprecationLookup {
  if (exp.source === null) return { kind: "named", name: exp.name };
  if (exp.importedName === null) return { kind: "default" };
  return { kind: "named", name: exp.importedName };
}

/**
 * Reads a source file for the deprecation check. Recoverable read errors are
 * pushed onto `warnings` and the function returns `null`; the scan continues
 * with `deprecated: false` for that Component.
 *
 * @param absolutePath - Absolute path of the source file to read.
 * @param warnings - Mutable accumulator for non-fatal warnings.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns The file contents, or `null` when the read failed.
 */
function readSourceForDeprecation(
  absolutePath: string,
  warnings: string[],
  cwd: string,
): string | null {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch (err) {
    const rel = toPosixPath(relative(cwd, absolutePath));
    warnings.push(
      `failed to read source "${rel}" for deprecation check: ${(err as Error).message}`,
    );
    return null;
  }
}

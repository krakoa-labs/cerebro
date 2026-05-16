import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { type BarrelWarning, type ExportShape, type ParsedExport, parseBarrel } from "./barrel.js";
import { readConfig } from "./config.js";
import { type DefinitionKind, detectDefinitionKind } from "./definition-kind-detector.js";
import { detectDeprecation } from "./deprecation-detector.js";
import type { ExportLookup } from "./export-resolution.js";
import { type ActivityLogEntry, type GitAvailability, inspectGit, readActivityLog } from "./git.js";
import { type ParsedSource, parseSource } from "./parse-source.js";
import { toPosixPath } from "./paths.js";
import { type PropsTyping, detectPropsTyping } from "./props-typing-detector.js";
import { findBarrelFile, resolveSourcePath } from "./source-resolution.js";
import {
  type StoryBreakdown,
  ZERO_STORIES,
  analyzeStoriesForComponent,
} from "./stories-counter.js";
import { type TestCounts, ZERO_TESTS, countTestsForComponent } from "./tests-counter.js";

export interface ScanOptions {
  cwd: string;
}

export interface ScannedComponent {
  name: string;
  path: string;
  tests: TestCounts;
  stories?: StoryBreakdown;
  deprecated: boolean;
  exportShape: ExportShape;
  propsTyping: PropsTyping;
  definitionKind: DefinitionKind;
  activityLog?: ActivityLogEntry[];
}

export interface ScanResult {
  components: ScannedComponent[];
  warnings: string[];
  git: GitAvailability;
}

/**
 * Reads the project config and scans the design system's components root,
 * extracting the list of public Components from the barrel index file.
 *
 * @param options - The scan options.
 * @param options.cwd - The project root directory.
 * @returns The alphabetically-sorted list of Components with their source
 *   paths relative to `cwd`, any non-fatal warnings produced during the scan,
 *   and the git availability of the scanned project.
 * @throws If the config is missing, invalid, or points to a non-existent
 *   components root, or if no barrel index file is found.
 */
export function scan({ cwd }: ScanOptions): ScanResult {
  const {
    componentsPath: componentsPathRel,
    usesStorybook,
    tracksActivityLog,
    activityLogDepth,
  } = readConfig(cwd);

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

  const barrelPath = findBarrelFile(componentsRoot);
  if (barrelPath === null) {
    throw new Error(
      `No barrel file found at "${componentsPathRel}/index.ts" or "${componentsPathRel}/index.tsx".`,
    );
  }

  const sourceText = readFileSync(barrelPath, "utf8");
  const barrelRel = toPosixPath(relative(cwd, barrelPath));
  const parsed = parseBarrel(sourceText, barrelRel);

  const parseWarnings = parsed.warnings.map(describeWarning);

  const barrelDir = dirname(barrelPath);
  const warnings: string[] = [...parseWarnings];

  const git = inspectGit(cwd);
  if (tracksActivityLog && !git.available) {
    warnings.push("activity log requested but the project is not a git repository");
  }
  if (tracksActivityLog && git.shallow) {
    warnings.push("shallow clone — activity log may be truncated");
  }
  const produceActivityLog = tracksActivityLog && git.available;

  // Resolve every export to its source file first: a Component's Git scope
  // depends on how many Components share its directory, which is only known
  // once the whole barrel has been resolved.
  const resolved = parsed.exports.flatMap((exp) => {
    const isBarrelLocal = exp.shape === "barrel-local";
    const absolutePath = isBarrelLocal
      ? barrelPath
      : resolveSourcePath(barrelDir, exp.source as string, exp.importedName);

    if (absolutePath === null) {
      warnings.push(`skipped export "${exp.name}": could not resolve "${exp.source}"`);
      return [];
    }

    return [{ exp, absolutePath, isBarrelLocal }];
  });

  const componentsPerDir = new Map<string, number>();
  for (const { absolutePath } of resolved) {
    const dir = dirname(absolutePath);
    componentsPerDir.set(dir, (componentsPerDir.get(dir) ?? 0) + 1);
  }

  const components = resolved.map(({ exp, absolutePath, isBarrelLocal }): ScannedComponent => {
    const rel = toPosixPath(relative(cwd, absolutePath));
    const tests = isBarrelLocal ? ZERO_TESTS : countTestsForComponent(absolutePath, warnings, cwd);

    const source = readAndParseSource(absolutePath, warnings, cwd);
    const lookup = lookupFor(exp);
    const deprecated = source === null ? false : detectDeprecation(source, lookup);
    const propsTyping = source === null ? "unanalyzed" : detectPropsTyping(source, lookup);
    const definitionKind = source === null ? "unanalyzed" : detectDefinitionKind(source, lookup);

    const stories = !usesStorybook
      ? undefined
      : isBarrelLocal
        ? ZERO_STORIES
        : analyzeStoriesForComponent(absolutePath, warnings, cwd);

    const activityLog = produceActivityLog
      ? readActivityLog(cwd, gitScopeOf(absolutePath, componentsPerDir, cwd), activityLogDepth)
      : undefined;

    return {
      name: exp.name,
      path: rel,
      tests,
      deprecated,
      exportShape: exp.shape,
      propsTyping,
      definitionKind,
      ...(stories !== undefined ? { stories } : {}),
      ...(activityLog !== undefined ? { activityLog } : {}),
    };
  });

  const sortedComponents = components.toSorted((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );

  // Only flag the barrel as silent when it has neither named exports nor any
  // unsupported shapes — wildcard/default warnings already explain emptiness.
  if (parsed.exports.length === 0 && parsed.warnings.length === 0) {
    warnings.push(`barrel "${barrelRel}" has no named exports`);
  }

  return { components: sortedComponents, warnings, git };
}

/**
 * Resolves a Component's Git scope — the path its activity log is read over.
 * The scope is the Component's directory when that Component alone resolves
 * its source file there, and the source file itself otherwise.
 *
 * @param absolutePath - The Component's resolved source file.
 * @param componentsPerDir - Count of Components resolving into each directory.
 * @param cwd - Project root, used to format the scope relative to it.
 * @returns The Git scope path, relative to `cwd`.
 */
function gitScopeOf(
  absolutePath: string,
  componentsPerDir: Map<string, number>,
  cwd: string,
): string {
  const dir = dirname(absolutePath);
  const scope = componentsPerDir.get(dir) === 1 ? dir : absolutePath;
  return toPosixPath(relative(cwd, scope));
}

/**
 * Renders a barrel parse warning as a human-readable scan warning line.
 *
 * @param warning - The structured warning raised during barrel parsing.
 * @returns The warning message to surface to the user.
 */
function describeWarning(warning: BarrelWarning): string {
  switch (warning.code) {
    case "wildcard-export":
      return `skipped wildcard export "${warning.detail}" (not supported in v1)`;
    case "namespace-reexport":
      return `skipped namespace re-export "${warning.detail}" (not supported in v1)`;
    case "default-export":
      return "skipped default export of the barrel (not supported in v1)";
  }
}

/**
 * Maps a barrel-parsed export to the lookup shape understood by the
 * per-Component source detectors. Only `default-reexport` shapes resolve to a
 * default lookup; every other shape resolves to a named lookup against the
 * source-side binding (or the barrel-side name when the export is declared
 * locally in the barrel).
 *
 * @param exp - The barrel-parsed export.
 * @returns The corresponding export lookup.
 */
function lookupFor(exp: ParsedExport): ExportLookup {
  if (exp.shape === "default-reexport") return { kind: "default" };
  return { kind: "named", name: exp.importedName ?? exp.name };
}

/**
 * Reads and parses a Component's source file once, for the per-Component
 * detectors to share. A recoverable read error or a fatal parse error is
 * recorded as a single warning and the function returns `null`; the scan then
 * reports that Component with each detector's fallback value. For barrel-local
 * Components the file is the barrel itself.
 *
 * @param absolutePath - Absolute path of the source file to read.
 * @param warnings - Mutable accumulator for non-fatal warnings.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns The parsed source, or `null` when the read or parse failed.
 */
function readAndParseSource(
  absolutePath: string,
  warnings: string[],
  cwd: string,
): ParsedSource | null {
  const rel = toPosixPath(relative(cwd, absolutePath));

  let text: string;
  try {
    text = readFileSync(absolutePath, "utf8");
  } catch (err) {
    warnings.push(`failed to read source "${rel}": ${(err as Error).message}`);
    return null;
  }

  try {
    return parseSource(text, absolutePath);
  } catch (err) {
    warnings.push(`failed to parse source "${rel}": ${(err as Error).message}`);
    return null;
  }
}

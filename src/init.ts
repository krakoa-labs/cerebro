import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { CONFIG_FILENAME, DEFAULT_ACTIVITY_LOG_DEPTH, writeConfig } from "./config.js";
import { detectGitRepo } from "./git.js";
import { toPosixPath } from "./paths.js";
import { CACHE_DIR } from "./scan-cache.js";

export interface InitOptions {
  cwd: string;
  componentsPath: string;
}

export interface InitResult {
  configPath: string;
  componentsPath: string;
  usesStorybook: boolean;
  usesFigmaCodeConnect: boolean;
  tracksActivityLog: boolean;
  gitignoreUpdated: boolean;
  warnings: string[];
}

const STORYBOOK_DIRNAME = ".storybook";

const CODE_CONNECT_PACKAGE = "@figma/code-connect";

export const CONVENTIONAL_COMPONENTS_PATHS = [
  "src/components",
  "src/lib/components",
  "lib/components",
  "components",
  "app/components",
];

/**
 * Detects whether the design system uses Storybook by checking for a
 * `.storybook/` directory at the project root.
 *
 * @param cwd - The project root directory to check.
 * @returns `true` when a `.storybook/` directory exists under `cwd`.
 */
export function detectStorybook(cwd: string): boolean {
  const stat = statSync(resolve(cwd, STORYBOOK_DIRNAME), { throwIfNoEntry: false });
  return stat?.isDirectory() ?? false;
}

/**
 * Detects whether the design system uses Figma Code Connect by checking for
 * the `@figma/code-connect` package in the `package.json` at the project root.
 * Both `dependencies` and `devDependencies` are inspected. A missing,
 * unreadable, or malformed `package.json` reads as "not detected".
 *
 * @param cwd - The project root directory to check.
 * @returns `true` when `@figma/code-connect` is declared as a dependency.
 */
export function detectCodeConnect(cwd: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
  } catch {
    return false;
  }

  return (
    declaresCodeConnect(parsed, "dependencies") || declaresCodeConnect(parsed, "devDependencies")
  );
}

/**
 * Checks whether a parsed `package.json` value declares `@figma/code-connect`
 * in the given dependency section.
 *
 * @param pkg - The parsed `package.json` value.
 * @param section - The dependency section to inspect.
 * @returns `true` when the section is an object listing `@figma/code-connect`.
 */
function declaresCodeConnect(pkg: unknown, section: "dependencies" | "devDependencies"): boolean {
  if (typeof pkg !== "object" || pkg === null) return false;
  const deps = (pkg as Record<string, unknown>)[section];
  return typeof deps === "object" && deps !== null && CODE_CONNECT_PACKAGE in deps;
}

/**
 * Detects the components folder of a design system by checking a fixed list of
 * conventional paths under `cwd`, in priority order. The first existing
 * directory wins.
 *
 * @param cwd - The project root directory to scan.
 * @returns The matching path relative to `cwd`, or `null` if no convention
 *   matches.
 */
export function detectComponentsPath(cwd: string): string | null {
  const match = CONVENTIONAL_COMPONENTS_PATHS.find((candidate) =>
    statSync(resolve(cwd, candidate), { throwIfNoEntry: false })?.isDirectory(),
  );

  return match ?? null;
}

/**
 * Initializes Cerebro in a design system by writing the components path to a
 * project config file at the root of `cwd`.
 *
 * @param options - The init options.
 * @param options.cwd - The project root directory.
 * @param options.componentsPath - Path to the components directory, absolute or
 *   relative to `cwd`. Absolute paths are normalized to a path relative to
 *   `cwd` before being written to the config.
 * @returns The resolved config path, the normalized components path, whether
 *   Storybook and Figma Code Connect were detected at `cwd`, whether `cwd` is a
 *   git repository, whether the cache directory was added to `.gitignore`, and
 *   any non-fatal warnings produced during validation.
 * @throws If `componentsPath` does not exist, is not a directory, or is outside
 *   the project root.
 * @throws If `cerebro.config.json` already exists in `cwd`.
 */
export function init({ cwd, componentsPath }: InitOptions): InitResult {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  const absoluteTarget = isAbsolute(componentsPath) ? componentsPath : resolve(cwd, componentsPath);

  const stat = statSync(absoluteTarget, { throwIfNoEntry: false });
  if (!stat) {
    throw new Error(`path "${componentsPath}" does not exist`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`path "${componentsPath}" is not a directory`);
  }

  const rawRelative = relative(cwd, absoluteTarget);
  if (rawRelative === "" || rawRelative.startsWith("..") || isAbsolute(rawRelative)) {
    throw new Error(`path "${componentsPath}" must be inside the project root`);
  }

  const normalized = toPosixPath(rawRelative);

  const warnings =
    readdirSync(absoluteTarget).length === 0 ? [`directory "${normalized}" is empty`] : [];

  const usesStorybook = detectStorybook(cwd);
  const usesFigmaCodeConnect = detectCodeConnect(cwd);
  const isGitRepo = detectGitRepo(cwd);
  const tracksActivityLog = isGitRepo;

  writeConfig(cwd, {
    componentsPath: normalized,
    usesStorybook,
    usesFigmaCodeConnect,
    tracksActivityLog,
    activityLogDepth: DEFAULT_ACTIVITY_LOG_DEPTH,
  });

  let gitignoreUpdated = false;
  if (isGitRepo) {
    const outcome = ignoreCacheDir(cwd);
    gitignoreUpdated = outcome.updated;
    if (outcome.warning !== undefined) warnings.push(outcome.warning);
  }

  return {
    configPath,
    componentsPath: normalized,
    usesStorybook,
    usesFigmaCodeConnect,
    tracksActivityLog,
    gitignoreUpdated,
    warnings,
  };
}

/**
 * Ensures the Cerebro cache directory is gitignored, so the re-derivable Scan
 * result cache is never committed. Appends `.cerebro/` to the project's
 * `.gitignore` — creating the file when absent — unless an entry already
 * covers it. Best-effort: a read or write failure is reported, not thrown.
 *
 * @param cwd - The project root whose `.gitignore` is updated.
 * @returns Whether the entry was newly added, and a warning when the
 *   `.gitignore` could not be updated.
 */
function ignoreCacheDir(cwd: string): { updated: boolean; warning?: string } {
  const entry = `${CACHE_DIR}/`;
  const gitignorePath = resolve(cwd, ".gitignore");

  try {
    let existing = "";
    try {
      existing = readFileSync(gitignorePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    const alreadyIgnored = existing
      .split("\n")
      .some((line) => line.trim() === entry || line.trim() === CACHE_DIR);
    if (alreadyIgnored) return { updated: false };

    const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
    writeFileSync(gitignorePath, `${prefix}${entry}\n`);
    return { updated: true };
  } catch (err) {
    return { updated: false, warning: `could not update .gitignore: ${(err as Error).message}` };
  }
}

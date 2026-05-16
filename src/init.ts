import { readdirSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { CONFIG_FILENAME, DEFAULT_ACTIVITY_LOG_DEPTH, writeConfig } from "./config.js";
import { detectGitRepo } from "./git.js";
import { toPosixPath } from "./paths.js";

export interface InitOptions {
  cwd: string;
  componentsPath: string;
}

export interface InitResult {
  configPath: string;
  componentsPath: string;
  usesStorybook: boolean;
  tracksActivityLog: boolean;
  warnings: string[];
}

const STORYBOOK_DIRNAME = ".storybook";

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
 *   Storybook was detected at `cwd`, whether `cwd` is a git repository, and any
 *   non-fatal warnings produced during validation.
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
  const tracksActivityLog = detectGitRepo(cwd);

  writeConfig(cwd, {
    componentsPath: normalized,
    usesStorybook,
    tracksActivityLog,
    activityLogDepth: DEFAULT_ACTIVITY_LOG_DEPTH,
  });

  return {
    configPath,
    componentsPath: normalized,
    usesStorybook,
    tracksActivityLog,
    warnings,
  };
}

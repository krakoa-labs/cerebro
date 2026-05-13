import { readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { toPosixPath } from "./paths.js";

export interface InitOptions {
  cwd: string;
  componentsPath: string;
}

export interface InitResult {
  configPath: string;
  componentsPath: string;
  warnings: string[];
}

export const CONFIG_FILENAME = "cerebro.config.json";

export const CONVENTIONAL_COMPONENTS_PATHS = [
  "src/components",
  "src/lib/components",
  "lib/components",
  "components",
  "app/components",
];

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
 * @returns The resolved config path, the normalized components path, and any
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

  const payload = `${JSON.stringify({ componentsPath: normalized }, null, 2)}\n`;
  try {
    writeFileSync(configPath, payload, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${CONFIG_FILENAME} already exists. Delete it to re-init.`);
    }
    throw err;
  }

  return {
    configPath,
    componentsPath: normalized,
    warnings,
  };
}

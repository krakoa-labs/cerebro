import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const CONFIG_FILENAME = "cerebro.config.json";

/** The activity log depth applied when the config does not specify one. */
export const DEFAULT_ACTIVITY_LOG_DEPTH = 20;

export interface CerebroConfig {
  componentsPath: string;
  usesStorybook: boolean;
  tracksActivityLog: boolean;
  activityLogDepth: number;
}

/**
 * Reads, parses, and validates the Cerebro config file at the root of `cwd`.
 *
 * @param cwd - The project root directory.
 * @returns The validated config: the components path, the Storybook flag, the
 *   activity-log tracking flag, and the activity log depth (absent boolean
 *   flags are normalized to `false`, an absent depth to its default).
 * @throws If the config file is missing, is not valid JSON, or has a shape
 *   that does not match the expected config.
 */
export function readConfig(cwd: string): CerebroConfig {
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

  const raw = ((): unknown => {
    try {
      return JSON.parse(configText);
    } catch (err) {
      throw new Error(`Failed to parse ${CONFIG_FILENAME}: ${(err as Error).message}`);
    }
  })();

  return validateConfig(raw);
}

/**
 * Serializes a Cerebro config and writes it to the root of `cwd`. The write
 * uses an exclusive flag, so an existing config file is never overwritten.
 *
 * @param cwd - The project root directory.
 * @param config - The config to serialize and write.
 * @throws If a config file already exists, or the write is denied or fails
 *   for lack of disk space.
 */
export function writeConfig(cwd: string, config: CerebroConfig): void {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  const payload = `${JSON.stringify(config, null, 2)}\n`;

  try {
    writeFileSync(configPath, payload, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new Error(`${CONFIG_FILENAME} already exists. Delete it to re-init.`);
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new Error(`permission denied writing ${CONFIG_FILENAME} in "${cwd}".`);
    }
    if (code === "ENOSPC") {
      throw new Error(`no space left on device when writing ${CONFIG_FILENAME}.`);
    }
    throw err;
  }
}

/**
 * Validates the raw JSON config payload and returns the normalized config.
 *
 * @param raw - The parsed JSON config value.
 * @returns The validated components path, Storybook flag, activity-log
 *   tracking flag, and activity log depth.
 * @throws If the config shape is invalid.
 */
function validateConfig(raw: unknown): CerebroConfig {
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

  const tal = (raw as { tracksActivityLog?: unknown }).tracksActivityLog;
  if (tal !== undefined && typeof tal !== "boolean") {
    throw new Error(
      `${CONFIG_FILENAME} has an invalid "tracksActivityLog" field: expected boolean, got ${typeof tal}.`,
    );
  }

  const ald = (raw as { activityLogDepth?: unknown }).activityLogDepth;
  if (ald !== undefined && (typeof ald !== "number" || !Number.isInteger(ald) || ald < 1)) {
    throw new Error(
      `${CONFIG_FILENAME} has an invalid "activityLogDepth" field: expected a positive integer, got ${
        typeof ald === "number" ? ald : typeof ald
      }.`,
    );
  }

  return {
    componentsPath: cp,
    usesStorybook: usb === true,
    tracksActivityLog: tal === true,
    activityLogDepth: ald === undefined ? DEFAULT_ACTIVITY_LOG_DEPTH : ald,
  };
}

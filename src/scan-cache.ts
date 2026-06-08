import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanResult } from "./scan.js";

/** The directory, at the project root, that holds Cerebro's cached output. */
export const CACHE_DIR = ".cerebro";

/** The persisted Scan result file, written inside {@link CACHE_DIR}. */
export const SCAN_CACHE_FILE = "scan.json";

/**
 * Persists a Scan result to the cache file under {@link CACHE_DIR}, creating
 * the directory when absent and overwriting any previous result. The cache is
 * a re-derivable artifact, not a system of record — git holds the source state
 * — so it is meant to be gitignored.
 *
 * @param cwd - The project root the cache directory is created under.
 * @param result - The Scan result envelope to persist.
 * @returns The path of the written cache file, relative to `cwd`.
 */
export function writeScanResult(cwd: string, result: ScanResult): string {
  mkdirSync(join(cwd, CACHE_DIR), { recursive: true });
  const relPath = join(CACHE_DIR, SCAN_CACHE_FILE);
  writeFileSync(join(cwd, relPath), `${JSON.stringify(result, null, 2)}\n`);
  return relPath;
}

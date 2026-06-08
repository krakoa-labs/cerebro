import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CACHE_DIR, SCAN_CACHE_FILE, writeScanResult } from "../src/scan-cache.js";
import type { ScanResult } from "../src/scan.js";

const RESULT: ScanResult = {
  schemaVersion: 1,
  toolVersion: "0.0.0",
  scannedCommit: null,
  committedAt: null,
  config: {
    componentsPath: "src/components",
    usesStorybook: false,
    usesFigmaCodeConnect: false,
    tracksActivityLog: false,
    activityLogDepth: 20,
  },
  components: [],
  warnings: [],
  git: { available: false, shallow: false },
};

describe("writeScanResult", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-cache-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("writes the result to .cerebro/scan.json, creating the directory", () => {
    const relPath = writeScanResult(cwd, RESULT);

    expect(relPath).toBe(join(CACHE_DIR, SCAN_CACHE_FILE));
    const written = JSON.parse(readFileSync(join(cwd, relPath), "utf8"));
    expect(written).toEqual(RESULT);
  });

  it("overwrites a previous cache on a re-scan", () => {
    writeScanResult(cwd, RESULT);
    writeScanResult(cwd, { ...RESULT, toolVersion: "9.9.9" });

    const written = JSON.parse(readFileSync(join(cwd, CACHE_DIR, SCAN_CACHE_FILE), "utf8"));
    expect(written.toolVersion).toBe("9.9.9");
  });
});

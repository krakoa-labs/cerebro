import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DIST_DIR, buildDashboard, injectScanResult } from "../src/build.js";
import { CONFIG_FILENAME } from "../src/config.js";
import { CACHE_DIR, SCAN_CACHE_FILE } from "../src/scan-cache.js";
import type { ScanResult } from "../src/scan.js";

const PLACEHOLDER = '<script id="cerebro-scan" type="application/json">null</script>';

const BASE_RESULT: ScanResult = {
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

/**
 * Extracts and parses the Scan result injected into a built `index.html`.
 *
 * @param html - The HTML produced by injection.
 * @returns The parsed Scan result.
 */
function extractInjected(html: string): ScanResult {
  const match = html.match(/<script id="cerebro-scan" type="application\/json">(.+?)<\/script>/s);
  if (!match?.[1]) throw new Error("No injected scan found in html");
  return JSON.parse(match[1]) as ScanResult;
}

describe("injectScanResult", () => {
  const html = `<!doctype html><html><head>${PLACEHOLDER}</head><body></body></html>`;

  it("replaces the placeholder with the serialized Scan result", () => {
    const injected = injectScanResult(html, BASE_RESULT);

    expect(injected).not.toContain(PLACEHOLDER);
    expect(extractInjected(injected)).toEqual(BASE_RESULT);
  });

  it("throws when the placeholder is missing", () => {
    expect(() => injectScanResult("<html></html>", BASE_RESULT)).toThrow(/placeholder/i);
  });

  it("escapes a </script> sequence inside the data", () => {
    const result = { ...BASE_RESULT, warnings: ["evil </script><script>alert(1)</script>"] };

    const injected = injectScanResult(html, result);

    expect(injected.match(/<\/script>/g)).toHaveLength(1);
    expect(extractInjected(injected)).toEqual(result);
  });

  it("does not interpret replacement patterns in the data", () => {
    const result = { ...BASE_RESULT, warnings: ["100% of $& and $1 and $' kept"] };

    expect(extractInjected(injectScanResult(html, result))).toEqual(result);
  });
});

describe("buildDashboard", () => {
  let cwd: string;
  let assetsDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-build-"));
    assetsDir = mkdtempSync(join(tmpdir(), "cerebro-assets-"));

    writeFileSync(join(cwd, CONFIG_FILENAME), JSON.stringify({ componentsPath: "src/components" }));
    mkdirSync(join(cwd, "src", "components"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "components", "index.ts"),
      "export const Button = () => null;\nexport const Card = () => null;\n",
    );

    mkdirSync(join(assetsDir, "assets"), { recursive: true });
    writeFileSync(
      join(assetsDir, "index.html"),
      `<!doctype html><html><head>${PLACEHOLDER}</head><body><div id="root"></div></body></html>`,
    );
    writeFileSync(join(assetsDir, "assets", "app.js"), "console.log('app');");
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(assetsDir, { recursive: true, force: true });
  });

  it("assembles the Dashboard: copied assets plus an index.html with the scan injected", () => {
    const { outDir } = buildDashboard({ cwd, assetsDir });

    expect(outDir).toBe(DIST_DIR);
    expect(existsSync(join(cwd, DIST_DIR, "assets", "app.js"))).toBe(true);

    const html = readFileSync(join(cwd, DIST_DIR, "index.html"), "utf8");
    const injected = extractInjected(html);
    expect(html).not.toContain(PLACEHOLDER);
    expect(injected.components.map((c) => c.name)).toEqual(["Button", "Card"]);
  });

  it("writes the scan cache as a side effect, like cerebro scan", () => {
    buildDashboard({ cwd, assetsDir });

    expect(existsSync(join(cwd, CACHE_DIR, SCAN_CACHE_FILE))).toBe(true);
  });

  it("clears stale files from a previous build", () => {
    buildDashboard({ cwd, assetsDir });
    writeFileSync(join(cwd, DIST_DIR, "stale-chunk.js"), "old");

    buildDashboard({ cwd, assetsDir });

    expect(existsSync(join(cwd, DIST_DIR, "stale-chunk.js"))).toBe(false);
  });

  it("throws a helpful error when the prebuilt assets are missing", () => {
    expect(() => buildDashboard({ cwd, assetsDir: join(assetsDir, "nope") })).toThrow(
      /dashboard assets/i,
    );
  });
});

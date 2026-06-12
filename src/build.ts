import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CACHE_DIR, writeScanResult } from "./scan-cache.js";
import { type ScanResult, scan } from "./scan.js";

/** The directory, inside {@link CACHE_DIR}, the built Dashboard is written to. */
export const DIST_DIR = join(CACHE_DIR, "dist");

/**
 * The inline JSON script the prebuilt Dashboard ships with a `null` body —
 * the slot the Scan result is injected into at build time.
 */
const PLACEHOLDER_PATTERN = /(<script id="cerebro-scan" type="application\/json">)null(<\/script>)/;

export interface BuildOptions {
  /** The design system root the Scan runs in. */
  cwd: string;
  /**
   * The directory holding the prebuilt Dashboard assets. Defaults to the
   * `dashboard/` directory shipped next to the compiled module — tests
   * override it with a fixture directory.
   */
  assetsDir?: string;
}

/**
 * Resolves the prebuilt Dashboard assets shipped with cerebro: the
 * `dashboard/` directory next to this module, which in the published package
 * is `dist/dashboard/` next to the bundled CLI.
 *
 * @returns The absolute assets directory path.
 */
function shippedAssetsDir(): string {
  return fileURLToPath(new URL("dashboard/", import.meta.url));
}

export interface BuildOutcome {
  /** The path of the built Dashboard, relative to `cwd`. */
  outDir: string;
  /** The Scan result the Dashboard was built from. */
  result: ScanResult;
}

/**
 * Injects a Scan result into the prebuilt Dashboard's `index.html`, replacing
 * the `null` body of its inline JSON placeholder script. The JSON is escaped
 * (every `<` becomes its unicode escape) so a `</script>` sequence inside the
 * data cannot terminate the script element early.
 *
 * @param html - The prebuilt `index.html` contents.
 * @param result - The Scan result to inject.
 * @returns The hydrated HTML.
 * @throws If the placeholder script is not present in `html`.
 */
export function injectScanResult(html: string, result: ScanResult): string {
  const json = JSON.stringify(result).replace(/</g, "\\u003c");
  const injected = html.replace(
    PLACEHOLDER_PATTERN,
    (_match, open: string, close: string) => `${open}${json}${close}`,
  );

  if (injected === html) {
    throw new Error(
      "Dashboard assets are corrupted: index.html is missing the scan placeholder script.",
    );
  }

  return injected;
}

/**
 * Builds the Dashboard: runs a fresh Scan of the design system at `cwd`,
 * copies the prebuilt Dashboard assets into `.cerebro/dist/`, and injects the
 * Scan result into the copied `index.html`. The scan cache is written as a
 * side effect, exactly as `cerebro scan` does — but never read: the rendered
 * Dashboard always reflects the state this build scanned (see ADR-0019). Any
 * previous build output is cleared first so stale hashed assets cannot
 * accumulate.
 *
 * @param options - The build options.
 * @param options.cwd - The design system root the Scan runs in.
 * @param options.assetsDir - The directory holding the prebuilt Dashboard assets.
 * @returns The built Dashboard's path (relative to `cwd`) and the Scan result
 *   it renders.
 * @throws If the prebuilt assets are missing, or if the Scan itself throws.
 */
export function buildDashboard({
  cwd,
  assetsDir = shippedAssetsDir(),
}: BuildOptions): BuildOutcome {
  const indexPath = join(assetsDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(
      `Prebuilt Dashboard assets not found at "${assetsDir}". This cerebro installation may be corrupted — try reinstalling.`,
    );
  }

  const result = scan({ cwd });
  writeScanResult(cwd, result);

  const outDir = join(cwd, DIST_DIR);
  rmSync(outDir, { recursive: true, force: true });
  cpSync(assetsDir, outDir, { recursive: true });

  const html = readFileSync(indexPath, "utf8");
  writeFileSync(join(outDir, "index.html"), injectScanResult(html, result));

  return { outDir: DIST_DIR, result };
}

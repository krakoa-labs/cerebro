import type { ScanResult } from "../../src/scan.js";
import { DEV_SCAN } from "./dev-scan";

/**
 * Reads the Scan result injected into the page by `cerebro build` — the JSON
 * body of the `#cerebro-scan` script element. The prebuilt asset ships the
 * placeholder `null`; in dev the sample scan stands in for it (the branch is
 * compiled away in production builds), and a production page that was somehow
 * never injected reads as "no data" rather than crashing.
 *
 * @returns The injected Scan result, or `null` when none was injected.
 */
export function readScanResult(): ScanResult | null {
  const element = document.getElementById("cerebro-scan");
  const parsed: unknown = element?.textContent ? JSON.parse(element.textContent) : null;

  if (parsed !== null) return parsed as ScanResult;
  if (import.meta.env.DEV) return DEV_SCAN;
  return null;
}

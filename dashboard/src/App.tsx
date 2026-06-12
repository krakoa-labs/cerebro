import { useMemo } from "react";
import type { ScanResult } from "../../src/scan.js";
import { useHashRoute } from "./router";
import { readScanResult } from "./scan-data";
import { ComponentPage } from "./views/Component";
import { ComponentsTable } from "./views/Components";
import { Overview } from "./views/Overview";

/**
 * The Dashboard shell: masthead with navigation, provenance strip, and the
 * routed view. Reads the injected Scan result once and renders an explicit
 * empty state when none was injected.
 *
 * @returns The app element.
 */
export function App() {
  const scan = useMemo(readScanResult, []);
  const route = useHashRoute();

  if (scan === null) {
    return (
      <div className="shell">
        <Masthead route="overview" />
        <div className="empty-state">
          <div className="title">NO SCAN INJECTED</div>
          <p>
            This page was opened without data. Run <code>cerebro build</code> in your design system
            and open the generated <code>.cerebro/dist/index.html</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Masthead route={route.kind} />
      <ProvenanceStrip scan={scan} />
      {route.kind === "overview" && <Overview scan={scan} />}
      {route.kind === "components" && (
        <ComponentsTable scan={scan} filter={route.filter} initialQuery={route.query} />
      )}
      {route.kind === "component" && <ComponentPage scan={scan} name={route.name} />}
    </div>
  );
}

/**
 * Renders the masthead: the Cerebro wordmark with its scanning pulse and the
 * two top-level navigation links.
 *
 * @param props - The active route kind, for the current-page marker.
 * @returns The masthead element.
 */
function Masthead({ route }: { route: string }) {
  return (
    <header className="masthead">
      <a href="#/" style={{ color: "inherit" }}>
        <span className="wordmark">
          <span className="pulse" />
          CEREBRO
        </span>
      </a>
      <nav>
        <a href="#/" aria-current={route === "overview"}>
          Overview
        </a>
        <a href="#/components" aria-current={route !== "overview"}>
          Components
        </a>
      </nav>
    </header>
  );
}

/**
 * Renders the provenance strip: what this Dashboard is a picture of — the
 * scanned commit and its committer date (the result's temporal anchor, never
 * the wall clock), the producing cerebro version, and the schema version.
 *
 * @param props - The Scan result.
 * @returns The strip element.
 */
function ProvenanceStrip({ scan }: { scan: ScanResult }) {
  return (
    <div className="provenance">
      <span>
        commit <b>{scan.scannedCommit ? scan.scannedCommit.slice(0, 7) : "n/a"}</b>
      </span>
      <span>
        committed <b>{scan.committedAt ? scan.committedAt.slice(0, 10) : "n/a"}</b>
      </span>
      <span>
        cerebro <b>v{scan.toolVersion}</b>
      </span>
      <span>
        schema <b>{scan.schemaVersion}</b>
      </span>
      <span>
        git <b>{scan.git.available ? (scan.git.shallow ? "shallow" : "ok") : "absent"}</b>
      </span>
    </div>
  );
}

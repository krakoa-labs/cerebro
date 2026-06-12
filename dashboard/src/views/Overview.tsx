import type { ScanResult } from "../../../src/scan.js";
import { deriveCoverage, filterComponents, overviewStats } from "../derive";
import { AttentionBar, CoverageRing, StatCard, filterHref } from "../ui";

/**
 * The Overview: the Scan's aggregates as instrument readouts — an inventory
 * row, presence-coverage rings, then a "needs attention" panel of debt bars
 * linking into the pre-filtered Component table. Stories and connections
 * render only when their usage flags are on; a gated-off gauge is absent,
 * not zeroed. The scan warnings render as a banner — the only honesty signal
 * a previewed Dashboard has (ADR-0018).
 *
 * @param props - The Scan result.
 * @returns The view element.
 */
export function Overview({ scan }: { scan: ScanResult }) {
  const stats = overviewStats(scan);
  const coverage = deriveCoverage(scan);
  const footgunComponents = filterComponents(scan.components, "footguns", "").length;

  return (
    <main>
      {scan.warnings.length > 0 && (
        <div className="warnings">
          {scan.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      <h2 className="section-label">Inventory</h2>
      <div className="cards">
        <StatCard
          label="Components"
          value={stats.componentCount}
          sub={`${stats.deprecated} deprecated · ${stats.classComponents} class`}
          href={filterHref(null)}
        />
        <StatCard
          label="Tests"
          value={stats.tests.total}
          sub={`${stats.tests.skipped} skipped · ${stats.tests.only} only`}
        />
        {stats.stories !== null && <StatCard label="Stories" value={stats.stories} />}
        {stats.connections !== null && (
          <StatCard
            label="Figma connections"
            value={stats.connections.total}
            sub={
              stats.connections.broken > 0 ? `${stats.connections.broken} broken` : "all resolved"
            }
          />
        )}
      </div>

      <h2 className="section-label">Coverage</h2>
      <div className="rings">
        <CoverageRing label="Tests" sub="with tests" {...coverage.tests} />
        {coverage.storybook && (
          <CoverageRing label="Storybook" sub="with stories" {...coverage.storybook} />
        )}
        {coverage.codeConnect && (
          <CoverageRing label="Code Connect" sub="connected" {...coverage.codeConnect} />
        )}
      </div>

      <h2 className="section-label">Needs attention</h2>
      <div className="bars">
        <AttentionBar
          label="Missing tests"
          count={coverage.tests.total - coverage.tests.covered}
          total={stats.componentCount}
          href={filterHref("untested")}
        />
        <AttentionBar
          label="Footguns"
          count={footgunComponents}
          total={stats.componentCount}
          href={filterHref("footguns")}
        />
        <AttentionBar
          label="Untyped props"
          count={stats.untyped}
          total={stats.componentCount}
          href={filterHref("untyped")}
        />
        <AttentionBar
          label="Deprecated"
          count={stats.deprecated}
          total={stats.componentCount}
          href={filterHref("deprecated")}
        />
        <AttentionBar
          label="Class components"
          count={stats.classComponents}
          total={stats.componentCount}
        />
        <AttentionBar
          label="Unanalyzed props"
          count={stats.unanalyzedProps}
          total={stats.componentCount}
        />
      </div>
    </main>
  );
}

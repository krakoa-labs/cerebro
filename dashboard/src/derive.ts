import type { ScanResult, ScannedComponent } from "../../src/scan.js";

/**
 * The consumer verdicts and aggregates the Dashboard derives from a raw Scan
 * result. The injected data is the Scan result untransformed — every
 * derivation lives here, in pure functions, so a stored copy can never drift
 * from the records it is derived from.
 */

/** A named predicate the Component table can be pre-filtered with. */
export type ComponentFilter = "deprecated" | "untyped" | "footguns" | "untested";

/** The filter values a route is allowed to carry. */
export const COMPONENT_FILTERS: readonly ComponentFilter[] = [
  "deprecated",
  "untyped",
  "footguns",
  "untested",
];

/** The aggregate counts the Overview renders. */
export interface OverviewStats {
  componentCount: number;
  deprecated: number;
  untyped: number;
  unanalyzedProps: number;
  classComponents: number;
  memoWithChildren: number;
  nestedComponentDefinition: number;
  forwardRefWithoutRef: number;
  tests: { total: number; skipped: number; only: number };
  /** Total stories, or `null` when Storybook usage is off. */
  stories: number | null;
  /** Connection totals, or `null` when Code Connect usage is off. */
  connections: { total: number; broken: number } | null;
}

/**
 * Inverts the per-Component `dependsOn` edge lists into fan-in: for every
 * Component, the alphabetically-sorted names of the Components that import
 * it. Every scanned Component gets an entry (empty when nothing imports it);
 * edges pointing at names outside the scanned set are ignored.
 *
 * @param components - The scanned Components.
 * @returns Component name to the names of its importers.
 */
export function deriveFanIn(components: ScannedComponent[]): Record<string, string[]> {
  const fanIn = Object.fromEntries(components.map((c) => [c.name, [] as string[]]));

  for (const c of components) {
    for (const target of c.dependsOn ?? []) {
      fanIn[target]?.push(c.name);
    }
  }

  return Object.fromEntries(
    Object.entries(fanIn).map(([name, importers]) => [name, importers.toSorted()]),
  );
}

/**
 * Counts a Component's broken Code Connect connections — entries whose `url`
 * is `null`, the quality-bearing signal the Scan deliberately keeps in the
 * list instead of dropping.
 *
 * @param component - The Component.
 * @returns The number of unresolved connections; `0` without a list.
 */
export function brokenConnectionCount(component: ScannedComponent): number {
  return (component.figmaConnections ?? []).filter((connection) => connection.url === null).length;
}

/**
 * Counts how many of the three boolean footgun Indicators (Memo with
 * children, Nested component definition, ForwardRef without ref) a Component
 * carries.
 *
 * @param component - The Component.
 * @returns A count between 0 and 3.
 */
export function footgunCount(component: ScannedComponent): number {
  return [
    component.memoWithChildren,
    component.nestedComponentDefinition,
    component.forwardRefWithoutRef,
  ].filter(Boolean).length;
}

/**
 * Reads the committer date of a Component's most recent activity — the first
 * entry of its Activity log, which the Scan records newest first.
 *
 * @param component - The Component.
 * @returns The ISO committer date, or `null` without an Activity log.
 */
export function newestActivity(component: ScannedComponent): string | null {
  return component.activityLog?.[0]?.committedAt ?? null;
}

/**
 * Aggregates a Scan result into the counts the Overview renders — the HTML
 * promotion of the summary line `cerebro scan` prints. Stories and
 * connections are gated by the config's usage flags: a gated-off aggregate is
 * `null` (absent), never zeroed, mirroring how the Scan result omits the
 * fields.
 *
 * @param result - The Scan result.
 * @returns The Overview aggregates.
 */
export function overviewStats(result: ScanResult): OverviewStats {
  const { components, config } = result;

  const count = (predicate: (c: ScannedComponent) => boolean): number =>
    components.filter(predicate).length;

  const tests = components.reduce(
    (acc, c) => ({
      total: acc.total + c.tests.total,
      skipped: acc.skipped + c.tests.skipped,
      only: acc.only + c.tests.only,
    }),
    { total: 0, skipped: 0, only: 0 },
  );

  return {
    componentCount: components.length,
    deprecated: count((c) => c.deprecated),
    untyped: count((c) => c.propsTyping === "untyped"),
    unanalyzedProps: count((c) => c.propsTyping === "unanalyzed"),
    classComponents: count((c) => c.definitionKind === "class"),
    memoWithChildren: count((c) => c.memoWithChildren),
    nestedComponentDefinition: count((c) => c.nestedComponentDefinition),
    forwardRefWithoutRef: count((c) => c.forwardRefWithoutRef),
    tests,
    stories: config.usesStorybook
      ? components.reduce((acc, c) => acc + (c.stories?.total ?? 0), 0)
      : null,
    connections: config.usesFigmaCodeConnect
      ? {
          total: components.reduce((acc, c) => acc + (c.figmaConnections?.length ?? 0), 0),
          broken: components.reduce((acc, c) => acc + brokenConnectionCount(c), 0),
        }
      : null,
  };
}

/** One coverage gauge: how many Components carry at least one of something. */
export interface CoverageSlice {
  covered: number;
  total: number;
  /** Rounded percentage; `0` on an empty scan rather than NaN. */
  pct: number;
}

/** The three coverage gauges the Overview renders as rings. */
export interface Coverage {
  tests: CoverageSlice;
  /** `null` when Storybook usage is off. */
  storybook: CoverageSlice | null;
  /** `null` when Code Connect usage is off. */
  codeConnect: CoverageSlice | null;
}

/**
 * Derives presence coverage across the scan: the share of Components carrying
 * at least one test, at least one story, and at least one Code Connect
 * connection. Presence only — "covered" does not judge depth or quality,
 * consistent with how Props typing reports presence, not soundness. Storybook
 * and Code Connect slices are gated by the config's usage flags.
 *
 * @param result - The Scan result.
 * @returns The three coverage slices.
 */
export function deriveCoverage(result: ScanResult): Coverage {
  const { components, config } = result;

  const slice = (predicate: (c: ScannedComponent) => boolean): CoverageSlice => {
    const covered = components.filter(predicate).length;
    const total = components.length;
    return { covered, total, pct: total === 0 ? 0 : Math.round((covered / total) * 100) };
  };

  return {
    tests: slice((c) => c.tests.total > 0),
    storybook: config.usesStorybook ? slice((c) => (c.stories?.total ?? 0) > 0) : null,
    codeConnect: config.usesFigmaCodeConnect
      ? slice((c) => (c.figmaConnections?.length ?? 0) > 0)
      : null,
  };
}

/**
 * Narrows the Component list by a named filter and a case-insensitive name
 * query, in that order. A `null` filter and an empty query each pass
 * everything through.
 *
 * @param components - The scanned Components.
 * @param filter - The named predicate, or `null` for none.
 * @param query - The name substring to match, case-insensitively.
 * @returns The Components matching both.
 */
export function filterComponents(
  components: ScannedComponent[],
  filter: ComponentFilter | null,
  query: string,
): ScannedComponent[] {
  const predicate = (c: ScannedComponent): boolean => {
    if (filter === "deprecated") return c.deprecated;
    if (filter === "untyped") return c.propsTyping === "untyped";
    if (filter === "footguns") return footgunCount(c) > 0;
    if (filter === "untested") return c.tests.total === 0;
    return true;
  };

  const needle = query.toLowerCase();
  return components
    .filter(predicate)
    .filter((c) => needle === "" || c.name.toLowerCase().includes(needle));
}

import { describe, expect, it } from "vitest";
import type { ScanResult, ScannedComponent } from "../../src/scan.js";
import {
  brokenConnectionCount,
  deriveCoverage,
  deriveFanIn,
  filterComponents,
  footgunCount,
  newestActivity,
  overviewStats,
} from "./derive";

/**
 * Builds a ScannedComponent with quiet defaults, overridable per test.
 *
 * @param overrides - Fields to override on the default component.
 * @returns The component.
 */
function component(overrides: Partial<ScannedComponent> & { name: string }): ScannedComponent {
  return {
    path: `src/components/${overrides.name}.tsx`,
    tests: { total: 0, skipped: 0, only: 0 },
    deprecated: false,
    exportShape: "named-reexport",
    propsTyping: "typed",
    definitionKind: "function",
    memoWithChildren: false,
    nestedComponentDefinition: false,
    forwardRefWithoutRef: false,
    ...overrides,
  };
}

/**
 * Wraps components in a minimal Scan result envelope.
 *
 * @param components - The components of the result.
 * @param config - Config flag overrides.
 * @returns The Scan result.
 */
function scanResult(
  components: ScannedComponent[],
  config: Partial<ScanResult["config"]> = {},
): ScanResult {
  return {
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
      ...config,
    },
    components,
    warnings: [],
    git: { available: false, shallow: false },
  };
}

describe("deriveFanIn", () => {
  it("inverts dependsOn into per-component importer lists", () => {
    const fanIn = deriveFanIn([
      component({ name: "Button" }),
      component({ name: "Card", dependsOn: ["Button"] }),
      component({ name: "Modal", dependsOn: ["Button", "Card"] }),
    ]);

    expect(fanIn).toEqual({ Button: ["Card", "Modal"], Card: ["Modal"], Modal: [] });
  });

  it("ignores edges pointing outside the scanned set", () => {
    const fanIn = deriveFanIn([component({ name: "Card", dependsOn: ["Ghost"] })]);

    expect(fanIn).toEqual({ Card: [] });
  });
});

describe("brokenConnectionCount", () => {
  it("counts connections whose url is null", () => {
    const c = component({
      name: "Button",
      figmaConnections: [{ url: "https://figma.com/f?node-id=1" }, { url: null }, { url: null }],
    });

    expect(brokenConnectionCount(c)).toBe(2);
  });

  it("is zero when the component has no connection list", () => {
    expect(brokenConnectionCount(component({ name: "Button" }))).toBe(0);
  });
});

describe("footgunCount", () => {
  it("counts the three boolean footgun indicators", () => {
    expect(footgunCount(component({ name: "A" }))).toBe(0);
    expect(
      footgunCount(component({ name: "B", memoWithChildren: true, forwardRefWithoutRef: true })),
    ).toBe(2);
  });
});

describe("newestActivity", () => {
  it("returns the committer date of the newest activity entry", () => {
    const c = component({
      name: "Button",
      activityLog: [
        {
          sha: "a".repeat(40),
          committedAt: "2026-05-12T10:00:00+00:00",
          authorName: "Steve",
          authorEmail: "s@x.com",
          subject: "fix",
        },
      ],
    });

    expect(newestActivity(c)).toBe("2026-05-12T10:00:00+00:00");
  });

  it("is null without an activity log", () => {
    expect(newestActivity(component({ name: "Button" }))).toBe(null);
  });
});

describe("overviewStats", () => {
  it("aggregates indicator counts across components", () => {
    const stats = overviewStats(
      scanResult([
        component({
          name: "Button",
          deprecated: true,
          propsTyping: "untyped",
          tests: { total: 3, skipped: 1, only: 0 },
        }),
        component({
          name: "Card",
          definitionKind: "class",
          propsTyping: "unanalyzed",
          memoWithChildren: true,
          nestedComponentDefinition: true,
          forwardRefWithoutRef: true,
          tests: { total: 2, skipped: 0, only: 1 },
        }),
      ]),
    );

    expect(stats).toEqual({
      componentCount: 2,
      deprecated: 1,
      untyped: 1,
      unanalyzedProps: 1,
      classComponents: 1,
      memoWithChildren: 1,
      nestedComponentDefinition: 1,
      forwardRefWithoutRef: 1,
      tests: { total: 5, skipped: 1, only: 1 },
      stories: null,
      connections: null,
    });
  });

  it("surfaces stories and connections only when their usage flags are on", () => {
    const stats = overviewStats(
      scanResult(
        [
          component({
            name: "Button",
            stories: { total: 4, csf1: 0, csf2: 1, csf3: 3, other: 0 },
            figmaConnections: [{ url: "https://figma.com/f?node-id=1" }, { url: null }],
          }),
        ],
        { usesStorybook: true, usesFigmaCodeConnect: true },
      ),
    );

    expect(stats.stories).toBe(4);
    expect(stats.connections).toEqual({ total: 2, broken: 1 });
  });
});

describe("deriveCoverage", () => {
  it("computes the share of components carrying at least one test, story, and connection", () => {
    const coverage = deriveCoverage(
      scanResult(
        [
          component({
            name: "Button",
            tests: { total: 3, skipped: 0, only: 0 },
            stories: { total: 2, csf1: 0, csf2: 0, csf3: 2, other: 0 },
            figmaConnections: [{ url: "https://figma.com/f?node-id=1" }],
          }),
          component({ name: "Card" }),
        ],
        { usesStorybook: true, usesFigmaCodeConnect: true },
      ),
    );

    expect(coverage.tests).toEqual({ covered: 1, total: 2, pct: 50 });
    expect(coverage.storybook).toEqual({ covered: 1, total: 2, pct: 50 });
    expect(coverage.codeConnect).toEqual({ covered: 1, total: 2, pct: 50 });
  });

  it("gates storybook and code connect coverage by the usage flags", () => {
    const coverage = deriveCoverage(scanResult([component({ name: "Button" })]));

    expect(coverage.storybook).toBe(null);
    expect(coverage.codeConnect).toBe(null);
    expect(coverage.tests).toEqual({ covered: 0, total: 1, pct: 0 });
  });

  it("reads an empty scan as zero percent, not NaN", () => {
    expect(deriveCoverage(scanResult([])).tests).toEqual({ covered: 0, total: 0, pct: 0 });
  });
});

describe("filterComponents", () => {
  const components = [
    component({ name: "Button", deprecated: true }),
    component({ name: "Card", propsTyping: "untyped" }),
    component({ name: "Modal", nestedComponentDefinition: true }),
  ];

  it("applies the named filter", () => {
    expect(filterComponents(components, "deprecated", "").map((c) => c.name)).toEqual(["Button"]);
    expect(filterComponents(components, "untyped", "").map((c) => c.name)).toEqual(["Card"]);
    expect(filterComponents(components, "footguns", "").map((c) => c.name)).toEqual(["Modal"]);
    expect(filterComponents(components, "untested", "")).toHaveLength(3);
  });

  it("applies a case-insensitive name query", () => {
    expect(filterComponents(components, null, "mod").map((c) => c.name)).toEqual(["Modal"]);
  });

  it("returns everything when neither filter nor query is set", () => {
    expect(filterComponents(components, null, "")).toEqual(components);
  });
});

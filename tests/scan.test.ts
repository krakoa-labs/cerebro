import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME } from "../src/init.js";
import { scan } from "../src/scan.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE_BARREL_BASICS = join(REPO_ROOT, "fixtures", "barrel-basics");
const FIXTURE_PROPS_TYPING = join(REPO_ROOT, "fixtures", "props-typing");

const ZERO_TESTS = { total: 0, skipped: 0, only: 0 };
const ZERO_STORIES = { total: 0, csf1: 0, csf2: 0, csf3: 0, other: 0 };

function writeConfig(cwd: string, componentsPath: string, usesStorybook = false): void {
  writeFileSync(join(cwd, CONFIG_FILENAME), JSON.stringify({ componentsPath, usesStorybook }));
}

function writeBarrel(cwd: string, componentsRel: string, contents: string): void {
  mkdirSync(join(cwd, componentsRel), { recursive: true });
  writeFileSync(join(cwd, componentsRel, "index.ts"), contents);
}

describe("scan", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-scan-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("throws when cerebro.config.json is missing", () => {
    expect(() => scan({ cwd })).toThrow(/No cerebro\.config\.json found/);
  });

  it("throws when the config is not valid JSON", () => {
    writeFileSync(join(cwd, CONFIG_FILENAME), "{ not json");
    expect(() => scan({ cwd })).toThrow(/Failed to parse cerebro\.config\.json/);
  });

  it("throws when the config is missing componentsPath", () => {
    writeFileSync(join(cwd, CONFIG_FILENAME), JSON.stringify({}));
    expect(() => scan({ cwd })).toThrow(/missing the "componentsPath" field/);
  });

  it.each([
    ["a JSON array", "[]"],
    ["JSON null", "null"],
  ])("rejects %s as the config root", (_label, content) => {
    writeFileSync(join(cwd, CONFIG_FILENAME), content);
    expect(() => scan({ cwd })).toThrow(/must contain a JSON object/);
  });

  it("throws when componentsPath is not a string", () => {
    writeFileSync(join(cwd, CONFIG_FILENAME), JSON.stringify({ componentsPath: 42 }));
    expect(() => scan({ cwd })).toThrow(/expected string, got number/);
  });

  it("throws when usesStorybook is present but not a boolean", () => {
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      JSON.stringify({ componentsPath: "src/components", usesStorybook: "yes" }),
    );
    expect(() => scan({ cwd })).toThrow(
      /invalid "usesStorybook" field: expected boolean, got string/,
    );
  });

  it("treats a config without usesStorybook as if it were false", () => {
    writeFileSync(join(cwd, CONFIG_FILENAME), JSON.stringify({ componentsPath: "src/components" }));
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    writeFileSync(
      join(cwd, "src", "components", "Button.stories.tsx"),
      "export default {}; export const Primary = {};",
    );

    const result = scan({ cwd });

    expect(result.components[0]?.stories).toBeUndefined();
  });

  it("throws when componentsPath does not exist", () => {
    writeConfig(cwd, "src/components");
    expect(() => scan({ cwd })).toThrow(/does not exist or is not a directory/);
  });

  it("throws when the components root has no barrel index", () => {
    writeConfig(cwd, "src/components");
    mkdirSync(join(cwd, "src", "components"), { recursive: true });
    expect(() => scan({ cwd })).toThrow(/No barrel file found/);
  });

  it("throws when componentsPath resolves outside the project root via symlink", () => {
    writeConfig(cwd, "src/components");
    mkdirSync(join(cwd, "src"));

    const outsideTarget = mkdtempSync(join(tmpdir(), "cerebro-outside-"));
    try {
      symlinkSync(outsideTarget, join(cwd, "src", "components"), "dir");
      expect(() => scan({ cwd })).toThrow(/resolves outside the project root via symlink/);
    } finally {
      rmSync(outsideTarget, { recursive: true, force: true });
    }
  });

  it("returns components sorted alphabetically, with local exports pointing at the barrel", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(
      cwd,
      "src/components",
      [
        `export { Zebra } from "./Zebra";`,
        "export const Apple = 1;",
        `export { default as Mango } from "./Mango";`,
      ].join("\n"),
    );
    writeFileSync(join(cwd, "src", "components", "Zebra.ts"), "");
    writeFileSync(join(cwd, "src", "components", "Mango.tsx"), "");

    const result = scan({ cwd });

    expect(result.components).toEqual([
      {
        name: "Apple",
        path: "src/components/index.ts",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "barrel-local",
        propsTyping: "unanalyzed",
      },
      {
        name: "Mango",
        path: "src/components/Mango.tsx",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "default-reexport",
        propsTyping: "unanalyzed",
      },
      {
        name: "Zebra",
        path: "src/components/Zebra.ts",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "named-reexport",
        propsTyping: "unanalyzed",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("warns on a wildcard export and skips it, without a 'no named exports' warning", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", `export * from "./Forms";`);

    const result = scan({ cwd });

    expect(result.components).toEqual([]);
    expect(result.warnings).toEqual([`skipped wildcard export "./Forms" (not supported in v1)`]);
  });

  it("warns on a namespace re-export and skips it without producing a Component", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", `export * as Forms from "./Forms";`);

    const result = scan({ cwd });

    expect(result.components).toEqual([]);
    expect(result.warnings).toEqual([
      `skipped namespace re-export "./Forms" (not supported in v1)`,
    ]);
  });

  it("warns on a default export and skips it", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", "const Lib = {}; export default Lib;");

    const result = scan({ cwd });

    expect(result.components).toEqual([]);
    expect(result.warnings).toEqual(["skipped default export of the barrel (not supported in v1)"]);
  });

  it("warns when a from clause cannot be resolved to a file", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", `export { Ghost } from "./ghost";`);

    const result = scan({ cwd });

    expect(result.components).toEqual([]);
    expect(result.warnings).toEqual([`skipped export "Ghost": could not resolve "./ghost"`]);
  });

  it("emits a 'no named exports' warning when the barrel is completely empty", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", "");

    const result = scan({ cwd });

    expect(result.components).toEqual([]);
    expect(result.warnings).toEqual([`barrel "src/components/index.ts" has no named exports`]);
  });

  it("resolves a folder re-export via its index file", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    mkdirSync(join(cwd, "src", "components", "Button"));
    writeFileSync(join(cwd, "src", "components", "Button", "index.tsx"), "");

    const result = scan({ cwd });

    expect(result.components).toEqual([
      {
        name: "Button",
        path: "src/components/Button/index.tsx",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "named-reexport",
        propsTyping: "unanalyzed",
      },
    ]);
  });

  it("prefers Foo/Foo.tsx over Foo/index.tsx when both exist", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", `export { Card } from "./Card";`);
    mkdirSync(join(cwd, "src", "components", "Card"));
    writeFileSync(join(cwd, "src", "components", "Card", "Card.tsx"), "");
    writeFileSync(join(cwd, "src", "components", "Card", "index.tsx"), "");

    const result = scan({ cwd });

    expect(result.components[0]?.path).toBe("src/components/Card/Card.tsx");
  });

  it("uses the imported name to disambiguate sibling files in the same folder", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(
      cwd,
      "src/components",
      [
        `import { FancySelect, FancyAsyncSelect } from "./FancySelect";`,
        "export { FancySelect, FancyAsyncSelect };",
      ].join("\n"),
    );
    mkdirSync(join(cwd, "src", "components", "FancySelect"));
    writeFileSync(join(cwd, "src", "components", "FancySelect", "FancySelect.tsx"), "");
    writeFileSync(join(cwd, "src", "components", "FancySelect", "FancyAsyncSelect.tsx"), "");
    writeFileSync(join(cwd, "src", "components", "FancySelect", "index.ts"), "");

    const result = scan({ cwd });

    expect(result.components.find((c) => c.name === "FancySelect")?.path).toBe(
      "src/components/FancySelect/FancySelect.tsx",
    );
    expect(result.components.find((c) => c.name === "FancyAsyncSelect")?.path).toBe(
      "src/components/FancySelect/FancyAsyncSelect.tsx",
    );
  });

  it("prefers .tsx over .ts during resolution", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", `export { Card } from "./Card";`);
    writeFileSync(join(cwd, "src", "components", "Card.ts"), "");
    writeFileSync(join(cwd, "src", "components", "Card.tsx"), "");

    const result = scan({ cwd });

    expect(result.components).toEqual([
      {
        name: "Card",
        path: "src/components/Card.tsx",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "named-reexport",
        propsTyping: "unanalyzed",
      },
    ]);
  });
});

describe("scan test counting", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-scan-tests-"));
    writeConfig(cwd, "src/components");
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("counts co-located *.test.tsx files", () => {
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    writeFileSync(
      join(cwd, "src", "components", "Button.test.tsx"),
      `it("a", () => {}); it.skip("b", () => {});`,
    );

    const result = scan({ cwd });

    expect(result.components[0]?.tests).toEqual({ total: 2, skipped: 1, only: 0 });
  });

  it("counts co-located *.spec.tsx files", () => {
    writeBarrel(cwd, "src/components", `export { Card } from "./Card";`);
    writeFileSync(join(cwd, "src", "components", "Card.tsx"), "");
    writeFileSync(
      join(cwd, "src", "components", "Card.spec.tsx"),
      `test("a", () => {}); test.only("b", () => {});`,
    );

    const result = scan({ cwd });

    expect(result.components[0]?.tests).toEqual({ total: 2, skipped: 0, only: 1 });
  });

  it("counts __tests__/ subfolder files", () => {
    writeBarrel(cwd, "src/components", `export { Modal } from "./Modal";`);
    writeFileSync(join(cwd, "src", "components", "Modal.tsx"), "");
    mkdirSync(join(cwd, "src", "components", "__tests__"));
    writeFileSync(
      join(cwd, "src", "components", "__tests__", "Modal.test.tsx"),
      `it("a", () => {}); it.todo("b");`,
    );

    const result = scan({ cwd });

    expect(result.components[0]?.tests).toEqual({ total: 2, skipped: 1, only: 0 });
  });

  it("sums tests across co-located and __tests__/ files", () => {
    writeBarrel(cwd, "src/components", `export { Tabs } from "./Tabs";`);
    writeFileSync(join(cwd, "src", "components", "Tabs.tsx"), "");
    writeFileSync(join(cwd, "src", "components", "Tabs.test.tsx"), `it("a", () => {});`);
    mkdirSync(join(cwd, "src", "components", "__tests__"));
    writeFileSync(
      join(cwd, "src", "components", "__tests__", "Tabs.test.tsx"),
      `it("b", () => {}); it.skip("c", () => {});`,
    );

    const result = scan({ cwd });

    expect(result.components[0]?.tests).toEqual({ total: 3, skipped: 1, only: 0 });
  });

  it("returns zero tests when no test file is found", () => {
    writeBarrel(cwd, "src/components", `export { Lone } from "./Lone";`);
    writeFileSync(join(cwd, "src", "components", "Lone.tsx"), "");

    const result = scan({ cwd });

    expect(result.components[0]?.tests).toEqual(ZERO_TESTS);
    expect(result.warnings).toEqual([]);
  });

  it("skips test lookup for Components declared locally in the barrel", () => {
    writeBarrel(cwd, "src/components", `export const Inline = "x";`);
    writeFileSync(
      join(cwd, "src", "components", "index.test.ts"),
      `it("would be ignored", () => {});`,
    );

    const result = scan({ cwd });

    expect(result.components[0]?.tests).toEqual(ZERO_TESTS);
  });

  it("warns on a test file with a parse error and continues the scan", () => {
    writeBarrel(cwd, "src/components", `export { Broken } from "./Broken";`);
    writeFileSync(join(cwd, "src", "components", "Broken.tsx"), "");
    writeFileSync(join(cwd, "src", "components", "Broken.test.tsx"), "it.skip(");

    const result = scan({ cwd });

    expect(result.components[0]?.name).toBe("Broken");
    expect(result.components[0]?.tests).toEqual(ZERO_TESTS);
    expect(result.warnings.some((w) => w.includes("failed to parse test file"))).toBe(true);
  });
});

describe("scan story counting", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-scan-stories-"));
    writeConfig(cwd, "src/components", true);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("breaks down CSF3 object-shaped stories from a co-located .stories.tsx file", () => {
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    writeFileSync(
      join(cwd, "src", "components", "Button.stories.tsx"),
      `export default {};
       export const Primary = {};
       export const Secondary = {};`,
    );

    const result = scan({ cwd });

    expect(result.components[0]?.stories).toEqual({
      total: 2,
      csf1: 0,
      csf2: 0,
      csf3: 2,
      other: 0,
    });
  });

  it("breaks down a co-located .stories.ts file as well", () => {
    writeBarrel(cwd, "src/components", `export { Token } from "./Token";`);
    writeFileSync(join(cwd, "src", "components", "Token.ts"), "");
    writeFileSync(
      join(cwd, "src", "components", "Token.stories.ts"),
      "export default {}; export const Default = {};",
    );

    const result = scan({ cwd });

    expect(result.components[0]?.stories?.csf3).toBe(1);
    expect(result.components[0]?.stories?.total).toBe(1);
  });

  it("sums CSF2 and CSF3 breakdowns across both .stories.tsx and .stories.ts files", () => {
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    writeFileSync(
      join(cwd, "src", "components", "Button.stories.tsx"),
      "export default {}; export const Primary = (args) => null;",
    );
    writeFileSync(
      join(cwd, "src", "components", "Button.stories.ts"),
      "export default {}; export const Secondary = {};",
    );

    const result = scan({ cwd });

    expect(result.components[0]?.stories).toEqual({
      total: 2,
      csf1: 0,
      csf2: 1,
      csf3: 1,
      other: 0,
    });
  });

  it("returns an all-zero breakdown when no stories file exists for the Component", () => {
    writeBarrel(cwd, "src/components", `export { Lone } from "./Lone";`);
    writeFileSync(join(cwd, "src", "components", "Lone.tsx"), "");

    const result = scan({ cwd });

    expect(result.components[0]?.stories).toEqual(ZERO_STORIES);
    expect(result.warnings).toEqual([]);
  });

  it("skips story lookup for Components declared locally in the barrel", () => {
    writeBarrel(cwd, "src/components", `export const Inline = "x";`);
    writeFileSync(
      join(cwd, "src", "components", "index.stories.ts"),
      "export default {}; export const Should = {}; export const NotCount = {};",
    );

    const result = scan({ cwd });

    expect(result.components[0]?.stories).toEqual(ZERO_STORIES);
  });

  it("warns on a stories file with a parse error and continues the scan", () => {
    writeBarrel(cwd, "src/components", `export { Broken } from "./Broken";`);
    writeFileSync(join(cwd, "src", "components", "Broken.tsx"), "");
    writeFileSync(join(cwd, "src", "components", "Broken.stories.tsx"), "export const Primary = (");

    const result = scan({ cwd });

    expect(result.components[0]?.name).toBe("Broken");
    expect(result.components[0]?.stories).toEqual(ZERO_STORIES);
    expect(result.warnings.some((w) => w.includes("failed to parse stories file"))).toBe(true);
  });

  it("omits the stories field entirely when usesStorybook is false in the config", () => {
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      JSON.stringify({ componentsPath: "src/components", usesStorybook: false }),
    );
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    writeFileSync(
      join(cwd, "src", "components", "Button.stories.tsx"),
      "export default {}; export const Primary = {};",
    );

    const result = scan({ cwd });

    expect(result.components[0]).not.toHaveProperty("stories");
  });
});

describe("scan props typing", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-scan-props-"));
    writeConfig(cwd, "src/components");
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("warns on a source file with a parse error and reports unanalyzed", () => {
    writeBarrel(cwd, "src/components", `export { Broken } from "./Broken";`);
    writeFileSync(join(cwd, "src", "components", "Broken.tsx"), "export const Broken = (props: ");

    const result = scan({ cwd });

    expect(result.components[0]?.propsTyping).toBe("unanalyzed");
    expect(result.warnings.some((w) => w.includes("for props-typing check"))).toBe(true);
  });
});

describe("scan against the props-typing fixture", () => {
  it("classifies props typing across every supported shape", () => {
    const result = scan({ cwd: FIXTURE_PROPS_TYPING });

    expect(result.components.map((c) => ({ name: c.name, propsTyping: c.propsTyping }))).toEqual([
      { name: "Alert", propsTyping: "untyped" },
      { name: "Badge", propsTyping: "typed" },
      { name: "Banner", propsTyping: "typed" },
      { name: "Button", propsTyping: "typed" },
      { name: "Card", propsTyping: "typed" },
      { name: "Checkbox", propsTyping: "untyped" },
      { name: "Dialog", propsTyping: "typed" },
      { name: "Divider", propsTyping: "untyped" },
      { name: "IconButton", propsTyping: "untyped" },
      { name: "Input", propsTyping: "typed" },
      { name: "LegacyModal", propsTyping: "unanalyzed" },
      { name: "Panel", propsTyping: "typed" },
      { name: "Pill", propsTyping: "typed" },
      { name: "Select", propsTyping: "typed" },
      { name: "Sheet", propsTyping: "typed" },
      { name: "Spinner", propsTyping: "typed" },
      { name: "Surface", propsTyping: "unanalyzed" },
      { name: "Tag", propsTyping: "typed" },
      { name: "ThemedBox", propsTyping: "unanalyzed" },
      { name: "Toast", propsTyping: "typed" },
      { name: "Token", propsTyping: "unanalyzed" },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("scan against the barrel-basics fixture", () => {
  it("produces the expected indicators for the canonical mixed-shape DS", () => {
    const result = scan({ cwd: FIXTURE_BARREL_BASICS });

    expect(result.components).toEqual([
      {
        name: "Button",
        path: "src/components/Button/Button.tsx",
        tests: { total: 5, skipped: 1, only: 1 },
        deprecated: false,
        exportShape: "named-reexport",
        propsTyping: "unanalyzed",
      },
      {
        name: "Card",
        path: "src/components/Card.tsx",
        tests: { total: 2, skipped: 0, only: 0 },
        deprecated: true,
        exportShape: "default-reexport",
        propsTyping: "unanalyzed",
      },
      {
        name: "Dialog",
        path: "src/components/Modal.tsx",
        tests: { total: 3, skipped: 1, only: 0 },
        deprecated: false,
        exportShape: "renamed-reexport",
        propsTyping: "unanalyzed",
      },
      {
        name: "Tooltip",
        path: "src/components/index.ts",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "barrel-local",
        propsTyping: "unanalyzed",
      },
      {
        name: "Variant",
        path: "src/components/index.ts",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "barrel-local",
        propsTyping: "unanalyzed",
      },
    ]);
    expect(result.warnings).toEqual([
      `skipped wildcard export "./Forms" (not supported in v1)`,
      "skipped default export of the barrel (not supported in v1)",
    ]);
  });
});

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME } from "../src/config.js";
import { scan } from "../src/scan.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE_BARREL_BASICS = join(REPO_ROOT, "fixtures", "barrel-basics");
const FIXTURE_DEFINITION_KIND = join(REPO_ROOT, "fixtures", "definition-kind");
const FIXTURE_PROPS_TYPING = join(REPO_ROOT, "fixtures", "props-typing");
const FIXTURE_STORYBOOK = join(REPO_ROOT, "fixtures", "storybook");
const FIXTURE_CODE_CONNECT = join(REPO_ROOT, "fixtures", "code-connect");
const FIXTURE_TSCONFIG_ALIASES = join(REPO_ROOT, "fixtures", "tsconfig-aliases");
const FIXTURE_INTERNAL_DEPENDENCIES = join(REPO_ROOT, "fixtures", "internal-dependencies");
const FIXTURE_EXTERNAL_DEPENDENCIES = join(REPO_ROOT, "fixtures", "external-dependencies");

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

  it("throws when usesFigmaCodeConnect is present but not a boolean", () => {
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      JSON.stringify({ componentsPath: "src/components", usesFigmaCodeConnect: "yes" }),
    );
    expect(() => scan({ cwd })).toThrow(
      /invalid "usesFigmaCodeConnect" field: expected boolean, got string/,
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
        definitionKind: "other",
        dependsOn: [],
        externalDependencies: [],
      },
      {
        name: "Mango",
        path: "src/components/Mango.tsx",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "default-reexport",
        propsTyping: "unanalyzed",
        definitionKind: "unanalyzed",
        dependsOn: [],
        externalDependencies: [],
      },
      {
        name: "Zebra",
        path: "src/components/Zebra.ts",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "named-reexport",
        propsTyping: "unanalyzed",
        definitionKind: "unanalyzed",
        dependsOn: [],
        externalDependencies: [],
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("reports git availability for the scanned project", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");

    const result = scan({ cwd });

    expect(result.git).toEqual({ available: false, shallow: false });
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
        definitionKind: "unanalyzed",
        dependsOn: [],
        externalDependencies: [],
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
        definitionKind: "unanalyzed",
        dependsOn: [],
        externalDependencies: [],
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

  it("counts a test file named after the Component, not the source file", () => {
    writeBarrel(cwd, "src/components", `export { default as PrimaryButton } from "./Button";`);
    writeFileSync(
      join(cwd, "src", "components", "Button.tsx"),
      "export default function Button() {}",
    );
    writeFileSync(join(cwd, "src", "components", "PrimaryButton.test.tsx"), `it("a", () => {});`);

    const result = scan({ cwd });

    expect(result.components[0]?.name).toBe("PrimaryButton");
    expect(result.components[0]?.tests).toEqual({ total: 1, skipped: 0, only: 0 });
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

  it("warns on a stories file with a parse error and continues the scan", () => {
    writeBarrel(cwd, "src/components", `export { Broken } from "./Broken";`);
    writeFileSync(join(cwd, "src", "components", "Broken.tsx"), "");
    writeFileSync(join(cwd, "src", "components", "Broken.stories.tsx"), "export const Primary = (");

    const result = scan({ cwd });

    expect(result.components[0]?.name).toBe("Broken");
    expect(result.components[0]?.stories).toEqual(ZERO_STORIES);
    expect(result.warnings.some((w) => w.includes("failed to parse stories file"))).toBe(true);
  });

  it("counts a stories file named after the Component, not the source file", () => {
    writeBarrel(cwd, "src/components", `export { default as PrimaryButton } from "./Button";`);
    writeFileSync(
      join(cwd, "src", "components", "Button.tsx"),
      "export default function Button() {}",
    );
    writeFileSync(
      join(cwd, "src", "components", "PrimaryButton.stories.tsx"),
      "export default {}; export const Basic = {};",
    );

    const result = scan({ cwd });

    expect(result.components[0]?.name).toBe("PrimaryButton");
    expect(result.components[0]?.stories?.total).toBe(1);
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

describe("scan Code Connect connections", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-scan-codeconnect-"));
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      JSON.stringify({ componentsPath: "src/components", usesFigmaCodeConnect: true }),
    );
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("collects figma.connect() connections in a co-located Code Connect file", () => {
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    writeFileSync(
      join(cwd, "src", "components", "Button.figma.tsx"),
      `figma.connect(Button, "https://figma.com/design/k?node-id=1-1", {});\n` +
        `figma.connect(Button, "https://figma.com/design/k?node-id=1-2", {});`,
    );

    const result = scan({ cwd });

    expect(result.components[0]?.figmaConnections).toEqual([
      { url: "https://figma.com/design/k?node-id=1-1" },
      { url: "https://figma.com/design/k?node-id=1-2" },
    ]);
  });

  it("resolves a placeholder URL through figma.config.json substitutions", () => {
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    writeFileSync(
      join(cwd, "src", "components", "Button.figma.tsx"),
      `figma.connect(Button, "<FIGMA_BUTTON>", {});`,
    );
    writeFileSync(
      join(cwd, "figma.config.json"),
      JSON.stringify({
        codeConnect: {
          documentUrlSubstitutions: {
            "<FIGMA_BUTTON>": "https://www.figma.com/design/abc/DS?node-id=9-9",
          },
        },
      }),
    );

    const result = scan({ cwd });

    expect(result.components[0]?.figmaConnections).toEqual([
      { url: "https://www.figma.com/design/abc/DS?node-id=9-9" },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("warns on a malformed figma.config.json and continues the scan", () => {
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    writeFileSync(join(cwd, "figma.config.json"), "{ not json");

    const result = scan({ cwd });

    expect(result.components[0]?.name).toBe("Button");
    expect(result.warnings.some((w) => w.includes("failed to parse figma.config.json"))).toBe(true);
  });

  it("reports no connections when no Code Connect file exists", () => {
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");

    const result = scan({ cwd });

    expect(result.components[0]?.figmaConnections).toEqual([]);
  });

  it("warns on a Code Connect file with a parse error and continues the scan", () => {
    writeBarrel(cwd, "src/components", `export { Broken } from "./Broken";`);
    writeFileSync(join(cwd, "src", "components", "Broken.tsx"), "");
    writeFileSync(join(cwd, "src", "components", "Broken.figma.tsx"), "figma.connect(");

    const result = scan({ cwd });

    expect(result.components[0]?.name).toBe("Broken");
    expect(result.components[0]?.figmaConnections).toEqual([]);
    expect(result.warnings.some((w) => w.includes("failed to parse Code Connect file"))).toBe(true);
  });

  it("omits the figmaConnections field entirely when usesFigmaCodeConnect is false", () => {
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      JSON.stringify({ componentsPath: "src/components", usesFigmaCodeConnect: false }),
    );
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    writeFileSync(
      join(cwd, "src", "components", "Button.figma.tsx"),
      `figma.connect(Button, "url", {});`,
    );

    const result = scan({ cwd });

    expect(result.components[0]).not.toHaveProperty("figmaConnections");
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

describe("scan against the storybook fixture", () => {
  it("breaks down stories by CSF generation across every shape", () => {
    const result = scan({ cwd: FIXTURE_STORYBOOK });

    expect(result.components.map((c) => ({ name: c.name, stories: c.stories }))).toEqual([
      { name: "Accordion", stories: { total: 2, csf1: 0, csf2: 1, csf3: 1, other: 0 } },
      { name: "Button", stories: { total: 3, csf1: 0, csf2: 0, csf3: 3, other: 0 } },
      { name: "Card", stories: { total: 2, csf1: 0, csf2: 2, csf3: 0, other: 0 } },
      { name: "Modal", stories: { total: 2, csf1: 2, csf2: 0, csf3: 0, other: 0 } },
      { name: "Pill", stories: ZERO_STORIES },
      { name: "Spinner", stories: ZERO_STORIES },
      { name: "Tabs", stories: { total: 2, csf1: 0, csf2: 0, csf3: 0, other: 2 } },
      { name: "Toast", stories: { total: 2, csf1: 0, csf2: 1, csf3: 1, other: 0 } },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("scan against the code-connect fixture", () => {
  it("collects figma.connect() connections per Component across every shape", () => {
    const result = scan({ cwd: FIXTURE_CODE_CONNECT });

    expect(
      result.components.map((c) => ({ name: c.name, figmaConnections: c.figmaConnections })),
    ).toEqual([
      {
        name: "Button",
        figmaConnections: [
          { url: "https://figma.com/design/abc?node-id=1-1" },
          {
            url: "https://www.figma.com/design/abc/Buttons?node-id=1-2",
            variant: { Size: "Large", Disabled: true },
          },
        ],
      },
      {
        name: "Card",
        figmaConnections: [{ url: "https://www.figma.com/design/cardKey/Cards?node-id=10-20" }],
      },
      { name: "Pill", figmaConnections: [] },
      { name: "Spinner", figmaConnections: [] },
      { name: "Toast", figmaConnections: [{ url: null }] },
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
        definitionKind: "other",
        dependsOn: [],
        externalDependencies: [],
      },
      {
        name: "Card",
        path: "src/components/Card.tsx",
        tests: { total: 2, skipped: 0, only: 0 },
        deprecated: true,
        exportShape: "default-reexport",
        propsTyping: "unanalyzed",
        definitionKind: "other",
        dependsOn: [],
        externalDependencies: [],
      },
      {
        name: "Dialog",
        path: "src/components/Modal.tsx",
        tests: { total: 3, skipped: 1, only: 0 },
        deprecated: false,
        exportShape: "renamed-reexport",
        propsTyping: "unanalyzed",
        definitionKind: "other",
        dependsOn: [],
        externalDependencies: [],
      },
      {
        name: "Tooltip",
        path: "src/components/index.ts",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "barrel-local",
        propsTyping: "unanalyzed",
        definitionKind: "other",
        dependsOn: [],
        externalDependencies: [],
      },
      {
        name: "Variant",
        path: "src/components/index.ts",
        tests: ZERO_TESTS,
        deprecated: false,
        exportShape: "barrel-local",
        propsTyping: "unanalyzed",
        definitionKind: "unanalyzed",
        dependsOn: [],
        externalDependencies: [],
      },
    ]);
    expect(result.warnings).toEqual([
      `skipped wildcard export "./Forms" (not supported in v1)`,
      "skipped default export of the barrel (not supported in v1)",
    ]);
  });
});

describe("scan source parsing", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-scan-parsing-"));
    writeConfig(cwd, "src/components");
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("reports a single warning when a component source fails to parse", () => {
    writeBarrel(cwd, "src/components", `export { Broken } from "./Broken";`);
    writeFileSync(join(cwd, "src", "components", "Broken.tsx"), "export const Broken = (props: ");

    const result = scan({ cwd });

    const broken = result.components[0];
    expect(broken?.deprecated).toBe(false);
    expect(broken?.propsTyping).toBe("unanalyzed");
    expect(broken?.definitionKind).toBe("unanalyzed");
    expect(result.warnings.filter((w) => w.includes("failed to parse source"))).toHaveLength(1);
  });
});

describe("scan activity log", () => {
  let cwd: string;

  // Pin the commit identity via environment variables: they outrank any GIT_*
  // vars a surrounding git hook may export into the test process.
  const commitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Dev",
    GIT_AUTHOR_EMAIL: "dev@example.com",
    GIT_COMMITTER_NAME: "Dev",
    GIT_COMMITTER_EMAIL: "dev@example.com",
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-scan-log-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function writeTrackingConfig(): void {
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      JSON.stringify({ componentsPath: "src/components", tracksActivityLog: true }),
    );
  }

  function commitAll(message: string): void {
    spawnSync("git", ["add", "."], { cwd });
    spawnSync("git", ["commit", "-m", message], { cwd, env: commitEnv });
  }

  it("attaches an activity log when tracking is on and the project is a git repo", () => {
    spawnSync("git", ["init"], { cwd });
    writeTrackingConfig();
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    commitAll("add Button");

    const result = scan({ cwd });

    expect(result.components[0]?.activityLog?.map((e) => e.subject)).toEqual(["add Button"]);
  });

  it("omits the activity log when tracking is off", () => {
    spawnSync("git", ["init"], { cwd });
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");
    commitAll("add Button");

    const result = scan({ cwd });

    expect(result.components[0]).not.toHaveProperty("activityLog");
  });

  it("omits the activity log and warns when tracking is on but not a git repo", () => {
    writeTrackingConfig();
    writeBarrel(cwd, "src/components", `export { Button } from "./Button";`);
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");

    const result = scan({ cwd });

    expect(result.components[0]).not.toHaveProperty("activityLog");
    expect(result.warnings.some((w) => w.includes("not a git repository"))).toBe(true);
  });

  it("scopes the log to the folder for a lone Component and to the file for siblings", () => {
    spawnSync("git", ["init"], { cwd });
    writeTrackingConfig();
    writeBarrel(
      cwd,
      "src/components",
      [
        `export { Solo } from "./Solo";`,
        `export { PairA } from "./pair/PairA";`,
        `export { PairB } from "./pair/PairB";`,
      ].join("\n"),
    );
    mkdirSync(join(cwd, "src", "components", "Solo"));
    writeFileSync(join(cwd, "src", "components", "Solo", "Solo.tsx"), "");
    mkdirSync(join(cwd, "src", "components", "pair"));
    writeFileSync(join(cwd, "src", "components", "pair", "PairA.tsx"), "");
    writeFileSync(join(cwd, "src", "components", "pair", "PairB.tsx"), "");
    commitAll("scaffold");

    writeFileSync(join(cwd, "src", "components", "Solo", "Solo.styles.ts"), "");
    commitAll("tweak Solo styles");

    writeFileSync(join(cwd, "src", "components", "pair", "PairA.tsx"), "// changed");
    commitAll("tweak PairA");

    const result = scan({ cwd });
    const subjectsOf = (name: string): string[] | undefined =>
      result.components.find((c) => c.name === name)?.activityLog?.map((e) => e.subject);

    expect(subjectsOf("Solo")).toEqual(["tweak Solo styles", "scaffold"]);
    expect(subjectsOf("PairA")).toEqual(["tweak PairA", "scaffold"]);
    expect(subjectsOf("PairB")).toEqual(["scaffold"]);
  });
});

describe("scan against the tsconfig-aliases fixture", () => {
  it("resolves barrel re-exports written through tsconfig path aliases", () => {
    const result = scan({ cwd: FIXTURE_TSCONFIG_ALIASES });

    expect(result.components.map((c) => ({ name: c.name, path: c.path }))).toEqual([
      { name: "Button", path: "src/components/Button/Button.tsx" },
      { name: "Card", path: "src/components/Card/Card.tsx" },
      { name: "Modal", path: "src/components/Modal.tsx" },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("scan against the internal-dependencies fixture", () => {
  it("records each Component's internal dependencies across every import shape", () => {
    const result = scan({ cwd: FIXTURE_INTERNAL_DEPENDENCIES });

    expect(result.components.map((c) => ({ name: c.name, dependsOn: c.dependsOn }))).toEqual([
      { name: "Button", dependsOn: ["Icon"] },
      { name: "Card", dependsOn: ["Button", "Icon"] },
      { name: "Dialog", dependsOn: ["Button", "Icon"] },
      { name: "Icon", dependsOn: [] },
      { name: "Modal", dependsOn: ["Icon"] },
      { name: "Tag", dependsOn: ["Icon"] },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("scan against the external-dependencies fixture", () => {
  it("records each Component's external dependencies across every import shape", () => {
    const result = scan({ cwd: FIXTURE_EXTERNAL_DEPENDENCIES });

    expect(
      result.components.map((c) => ({
        name: c.name,
        externalDependencies: c.externalDependencies,
      })),
    ).toEqual([
      { name: "Badge", externalDependencies: ["@radix-ui/react-dialog", "clsx", "lodash"] },
      { name: "Button", externalDependencies: ["react-dom"] },
      { name: "Card", externalDependencies: ["@acme/design-tokens", "date-fns"] },
      { name: "Icon", externalDependencies: [] },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

describe("scan internal dependencies", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-scan-deps-"));
    writeConfig(cwd, "src/components");
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("omits dependsOn and externalDependencies when the component source fails to parse", () => {
    writeBarrel(cwd, "src/components", `export { Broken } from "./Broken";`);
    writeFileSync(join(cwd, "src", "components", "Broken.tsx"), "export const Broken = (props: ");

    const result = scan({ cwd });

    expect(result.components[0]?.name).toBe("Broken");
    expect(result.components[0]).not.toHaveProperty("dependsOn");
    expect(result.components[0]).not.toHaveProperty("externalDependencies");
  });

  it("links an edge to every Component a shared source file backs", () => {
    writeBarrel(
      cwd,
      "src/components",
      [`export { Field, AsyncField } from "./Field";`, `export { Form } from "./Form";`].join("\n"),
    );
    writeFileSync(
      join(cwd, "src", "components", "Field.tsx"),
      "export const Field = 1; export const AsyncField = 2;",
    );
    writeFileSync(
      join(cwd, "src", "components", "Form.tsx"),
      `import { Field } from "./Field";\nexport const Form = () => Field;`,
    );

    const result = scan({ cwd });

    expect(result.components.find((c) => c.name === "Form")?.dependsOn).toEqual([
      "AsyncField",
      "Field",
    ]);
  });

  it("excludes test files from the Component scope", () => {
    writeBarrel(
      cwd,
      "src/components",
      [`export { Widget } from "./Widget/Widget";`, `export { Other } from "./Other";`].join("\n"),
    );
    mkdirSync(join(cwd, "src", "components", "Widget"));
    writeFileSync(
      join(cwd, "src", "components", "Widget", "Widget.tsx"),
      "export const Widget = 1;",
    );
    writeFileSync(
      join(cwd, "src", "components", "Widget", "Widget.test.tsx"),
      `import { Other } from "../Other";\nit("x", () => {});`,
    );
    writeFileSync(join(cwd, "src", "components", "Other.tsx"), "export const Other = 1;");

    const result = scan({ cwd });

    expect(result.components.find((c) => c.name === "Widget")?.dependsOn).toEqual([]);
  });

  it("excludes __storybook__ support files from the Component scope", () => {
    writeBarrel(
      cwd,
      "src/components",
      [`export { Widget } from "./Widget/Widget";`, `export { Other } from "./Other";`].join("\n"),
    );
    mkdirSync(join(cwd, "src", "components", "Widget", "__storybook__"), { recursive: true });
    writeFileSync(
      join(cwd, "src", "components", "Widget", "Widget.tsx"),
      "export const Widget = 1;",
    );
    writeFileSync(
      join(cwd, "src", "components", "Widget", "__storybook__", "decorator.tsx"),
      `import { Other } from "../../Other";\nexport const decorator = () => Other;`,
    );
    writeFileSync(join(cwd, "src", "components", "Other.tsx"), "export const Other = 1;");

    const result = scan({ cwd });

    expect(result.components.find((c) => c.name === "Widget")?.dependsOn).toEqual([]);
  });

  it("excludes a Component's edge to itself", () => {
    writeBarrel(cwd, "src/components", `export { Loop } from "./Loop/Loop";`);
    mkdirSync(join(cwd, "src", "components", "Loop"));
    writeFileSync(
      join(cwd, "src", "components", "Loop", "Loop.tsx"),
      `import { Loop } from "..";\nexport const Loop = () => Loop;`,
    );

    const result = scan({ cwd });

    expect(result.components[0]?.dependsOn).toEqual([]);
  });
});

describe("scan against the definition-kind fixture", () => {
  it("classifies the definition kind across every supported shape", () => {
    const result = scan({ cwd: FIXTURE_DEFINITION_KIND });

    expect(
      result.components.map((c) => ({ name: c.name, definitionKind: c.definitionKind })),
    ).toEqual([
      { name: "ArrowButton", definitionKind: "function" },
      { name: "CastButton", definitionKind: "function" },
      { name: "CastInput", definitionKind: "function" },
      { name: "ClassDialog", definitionKind: "class" },
      { name: "ClassModal", definitionKind: "class" },
      { name: "ConnectedMenu", definitionKind: "other" },
      { name: "FnBadge", definitionKind: "function" },
      { name: "MemoCard", definitionKind: "function" },
      { name: "PlainHelper", definitionKind: "other" },
      { name: "PureBadge", definitionKind: "class" },
      { name: "RefInput", definitionKind: "function" },
      { name: "StyledBox", definitionKind: "other" },
      { name: "Token", definitionKind: "other" },
      { name: "WrappedTabs", definitionKind: "function" },
    ]);
    expect(result.warnings).toEqual([]);
  });
});

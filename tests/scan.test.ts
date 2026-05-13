import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME } from "../src/init.js";
import { scan } from "../src/scan.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE_BARREL_BASICS = join(REPO_ROOT, "fixtures", "barrel-basics");

const ZERO_TESTS = { total: 0, skipped: 0, only: 0 };

function writeConfig(cwd: string, componentsPath: string): void {
  writeFileSync(join(cwd, CONFIG_FILENAME), JSON.stringify({ componentsPath }));
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
    expect(() => scan({ cwd })).toThrow(/missing a valid "componentsPath"/);
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
      { name: "Apple", path: "src/components/index.ts", tests: ZERO_TESTS },
      { name: "Mango", path: "src/components/Mango.tsx", tests: ZERO_TESTS },
      { name: "Zebra", path: "src/components/Zebra.ts", tests: ZERO_TESTS },
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
      { name: "Button", path: "src/components/Button/index.tsx", tests: ZERO_TESTS },
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
      { name: "Card", path: "src/components/Card.tsx", tests: ZERO_TESTS },
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

describe("scan against the barrel-basics fixture", () => {
  it("produces the expected indicators for the canonical mixed-shape DS", () => {
    const result = scan({ cwd: FIXTURE_BARREL_BASICS });

    expect(result.components).toEqual([
      {
        name: "Button",
        path: "src/components/Button/Button.tsx",
        tests: { total: 5, skipped: 1, only: 1 },
      },
      {
        name: "Card",
        path: "src/components/Card.tsx",
        tests: { total: 2, skipped: 0, only: 0 },
      },
      {
        name: "Dialog",
        path: "src/components/Modal.tsx",
        tests: { total: 3, skipped: 1, only: 0 },
      },
      { name: "Tooltip", path: "src/components/index.ts", tests: ZERO_TESTS },
      { name: "Variant", path: "src/components/index.ts", tests: ZERO_TESTS },
    ]);
    expect(result.warnings).toEqual([
      `skipped wildcard export "./Forms" (not supported in v1)`,
      "skipped default export of the barrel (not supported in v1)",
    ]);
  });
});

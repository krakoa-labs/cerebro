import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME } from "../src/init.js";
import { scan } from "../src/scan.js";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE_BARREL_BASICS = join(REPO_ROOT, "fixtures", "barrel-basics");

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
      { name: "Apple", path: "src/components/index.ts" },
      { name: "Mango", path: "src/components/Mango.tsx" },
      { name: "Zebra", path: "src/components/Zebra.ts" },
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
      { name: "Button", path: "src/components/Button/index.tsx" },
    ]);
  });

  it("prefers .tsx over .ts during resolution", () => {
    writeConfig(cwd, "src/components");
    writeBarrel(cwd, "src/components", `export { Card } from "./Card";`);
    writeFileSync(join(cwd, "src", "components", "Card.ts"), "");
    writeFileSync(join(cwd, "src", "components", "Card.tsx"), "");

    const result = scan({ cwd });

    expect(result.components).toEqual([{ name: "Card", path: "src/components/Card.tsx" }]);
  });
});

describe("scan against the barrel-basics fixture", () => {
  it("produces the expected indicators for the canonical mixed-shape DS", () => {
    const result = scan({ cwd: FIXTURE_BARREL_BASICS });

    expect(result.components).toEqual([
      { name: "Button", path: "src/components/Button/Button.tsx" },
      { name: "Card", path: "src/components/Card.tsx" },
      { name: "Dialog", path: "src/components/Modal.tsx" },
      { name: "Tooltip", path: "src/components/index.ts" },
      { name: "Variant", path: "src/components/index.ts" },
    ]);
    expect(result.warnings).toEqual([
      `skipped wildcard export "./Forms" (not supported in v1)`,
      "skipped default export of the barrel (not supported in v1)",
    ]);
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME, init } from "../src/init.js";

describe("init", () => {
  let cwd: string;
  let outsideRoot: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-init-"));
    outsideRoot = mkdtempSync(join(tmpdir(), "cerebro-outside-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  });

  it("writes config with relative path when given a valid relative path", () => {
    mkdirSync(join(cwd, "src", "components"), { recursive: true });
    writeFileSync(join(cwd, "src", "components", "Button.tsx"), "");

    const result = init({ cwd, componentsPath: "src/components" });

    expect(result.componentsPath).toBe("src/components");
    expect(result.warnings).toEqual([]);

    const config = JSON.parse(readFileSync(join(cwd, CONFIG_FILENAME), "utf8"));
    expect(config).toEqual({ componentsPath: "src/components" });
  });

  it("normalizes absolute paths to relative", () => {
    const absoluteComponents = join(cwd, "components");
    mkdirSync(absoluteComponents);
    writeFileSync(join(absoluteComponents, "Button.tsx"), "");

    const result = init({ cwd, componentsPath: absoluteComponents });

    expect(result.componentsPath).toBe("components");
  });

  it("warns when the directory is empty but still writes config", () => {
    mkdirSync(join(cwd, "src", "components"), { recursive: true });

    const result = init({ cwd, componentsPath: "src/components" });

    expect(result.warnings).toContain('directory "src/components" is empty');
    expect(existsSync(join(cwd, CONFIG_FILENAME))).toBe(true);
  });

  it("rejects a path that does not exist", () => {
    expect(() => init({ cwd, componentsPath: "nope" })).toThrow(/does not exist/);
    expect(existsSync(join(cwd, CONFIG_FILENAME))).toBe(false);
  });

  it("rejects a path that is a file rather than a directory", () => {
    writeFileSync(join(cwd, "file.txt"), "");

    expect(() => init({ cwd, componentsPath: "file.txt" })).toThrow(/not a directory/);
    expect(existsSync(join(cwd, CONFIG_FILENAME))).toBe(false);
  });

  it("rejects a path outside the project root", () => {
    expect(() => init({ cwd, componentsPath: outsideRoot })).toThrow(
      /must be inside the project root/,
    );
    expect(existsSync(join(cwd, CONFIG_FILENAME))).toBe(false);
  });

  it("rejects when cerebro.config.json already exists and leaves the file untouched", () => {
    mkdirSync(join(cwd, "src", "components"), { recursive: true });
    const existing = '{"componentsPath":"old/value"}';
    writeFileSync(join(cwd, CONFIG_FILENAME), existing);

    expect(() => init({ cwd, componentsPath: "src/components" })).toThrow(/already exists/);
    expect(readFileSync(join(cwd, CONFIG_FILENAME), "utf8")).toBe(existing);
  });
});

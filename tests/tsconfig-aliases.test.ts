import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTsconfigAliases } from "../src/tsconfig-aliases.js";

describe("readTsconfigAliases", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-tsconfig-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function write(relativePath: string, contents: string): void {
    const full = join(cwd, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }

  function writeJson(relativePath: string, value: unknown): void {
    write(relativePath, JSON.stringify(value, null, 2));
  }

  it("yields no candidates when the project has no tsconfig", () => {
    const warnings: string[] = [];
    const expand = readTsconfigAliases(cwd, warnings);

    expect(expand("@/components/Button")).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("expands a wildcard alias to its target", () => {
    writeJson("tsconfig.json", {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });
    const expand = readTsconfigAliases(cwd, []);

    expect(expand("@/components/Button")).toEqual([resolve(cwd, "src/components/Button")]);
  });

  it("expands an exact, non-wildcard alias", () => {
    writeJson("tsconfig.json", {
      compilerOptions: { baseUrl: ".", paths: { "@ds": ["src/index"] } },
    });
    const expand = readTsconfigAliases(cwd, []);

    expect(expand("@ds")).toEqual([resolve(cwd, "src/index")]);
  });

  it("resolves paths against the tsconfig directory when no baseUrl is set", () => {
    writeJson("tsconfig.json", {
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    });
    const expand = readTsconfigAliases(cwd, []);

    expect(expand("@/lib")).toEqual([resolve(cwd, "src/lib")]);
  });

  it("falls back to baseUrl for a bare specifier that matches no alias", () => {
    writeJson("tsconfig.json", { compilerOptions: { baseUrl: "src" } });
    const expand = readTsconfigAliases(cwd, []);

    expect(expand("components/Button")).toEqual([resolve(cwd, "src/components/Button")]);
  });

  it("prefers the most specific matching pattern", () => {
    writeJson("tsconfig.json", {
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"], "@/components/*": ["src/ui/*"] },
      },
    });
    const expand = readTsconfigAliases(cwd, []);

    expect(expand("@/components/Button")).toEqual([resolve(cwd, "src/ui/Button")]);
  });

  it("tolerates comments and trailing commas in tsconfig.json", () => {
    write(
      "tsconfig.json",
      `{
        // design system aliases
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@/*": ["src/*"], /* the source root */
          },
        },
      }`,
    );
    const expand = readTsconfigAliases(cwd, []);

    expect(expand("@/Button")).toEqual([resolve(cwd, "src/Button")]);
  });

  it("follows a relative extends chain", () => {
    writeJson("tsconfig.base.json", {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });
    writeJson("tsconfig.json", { extends: "./tsconfig.base.json" });
    const expand = readTsconfigAliases(cwd, []);

    expect(expand("@/Button")).toEqual([resolve(cwd, "src/Button")]);
  });

  it("lets a child tsconfig override the extended paths", () => {
    writeJson("tsconfig.base.json", {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["base/*"] } },
    });
    writeJson("tsconfig.json", {
      extends: "./tsconfig.base.json",
      compilerOptions: { paths: { "@/*": ["src/*"] } },
    });
    const expand = readTsconfigAliases(cwd, []);

    expect(expand("@/Button")).toEqual([resolve(cwd, "src/Button")]);
  });

  it("warns and yields no candidates on a malformed tsconfig", () => {
    write("tsconfig.json", "{ not json");
    const warnings: string[] = [];
    const expand = readTsconfigAliases(cwd, warnings);

    expect(expand("@/Button")).toEqual([]);
    expect(warnings.some((w) => w.includes("failed to parse tsconfig file"))).toBe(true);
  });

  it("ignores relative specifiers", () => {
    writeJson("tsconfig.json", {
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });
    const expand = readTsconfigAliases(cwd, []);

    expect(expand("./Button")).toEqual([]);
  });
});

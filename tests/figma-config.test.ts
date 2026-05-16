import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDocumentUrlSubstitutions } from "../src/figma-config.js";

describe("readDocumentUrlSubstitutions", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cerebro-figma-config-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("returns an empty map with no warning when figma.config.json is absent", () => {
    const warnings: string[] = [];
    expect(readDocumentUrlSubstitutions(cwd, warnings)).toEqual({});
    expect(warnings).toEqual([]);
  });

  it("reads the documentUrlSubstitutions map", () => {
    writeFileSync(
      join(cwd, "figma.config.json"),
      JSON.stringify({
        codeConnect: {
          documentUrlSubstitutions: {
            "<FIGMA_BUTTON>": "https://www.figma.com/design/abc/DS?node-id=1-2",
          },
        },
      }),
    );
    const warnings: string[] = [];
    expect(readDocumentUrlSubstitutions(cwd, warnings)).toEqual({
      "<FIGMA_BUTTON>": "https://www.figma.com/design/abc/DS?node-id=1-2",
    });
    expect(warnings).toEqual([]);
  });

  it("warns and returns an empty map on invalid JSON", () => {
    writeFileSync(join(cwd, "figma.config.json"), "{ not json");
    const warnings: string[] = [];
    expect(readDocumentUrlSubstitutions(cwd, warnings)).toEqual({});
    expect(warnings.some((w) => w.includes("failed to parse figma.config.json"))).toBe(true);
  });

  it("warns and returns an empty map when the config cannot be read", () => {
    mkdirSync(join(cwd, "figma.config.json"));
    const warnings: string[] = [];
    expect(readDocumentUrlSubstitutions(cwd, warnings)).toEqual({});
    expect(warnings.some((w) => w.includes("failed to read figma.config.json"))).toBe(true);
  });

  it("returns an empty map when codeConnect or documentUrlSubstitutions is missing", () => {
    writeFileSync(join(cwd, "figma.config.json"), JSON.stringify({ codeConnect: {} }));
    expect(readDocumentUrlSubstitutions(cwd, [])).toEqual({});
  });

  it("keeps only the string-valued substitution entries", () => {
    writeFileSync(
      join(cwd, "figma.config.json"),
      JSON.stringify({
        codeConnect: {
          documentUrlSubstitutions: {
            "<FIGMA_OK>": "https://www.figma.com/design/abc/DS?node-id=1-2",
            "<FIGMA_BAD>": 42,
          },
        },
      }),
    );
    expect(readDocumentUrlSubstitutions(cwd, [])).toEqual({
      "<FIGMA_OK>": "https://www.figma.com/design/abc/DS?node-id=1-2",
    });
  });
});

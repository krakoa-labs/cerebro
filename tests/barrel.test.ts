import { describe, expect, it } from "vitest";
import { parseBarrel } from "../src/barrel.js";

describe("parseBarrel", () => {
  it("returns no exports for an empty file", () => {
    const result = parseBarrel("", "index.ts");
    expect(result.exports).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("extracts a local variable export", () => {
    const result = parseBarrel("export const Tooltip = 'x';", "index.ts");
    expect(result.exports).toEqual([{ name: "Tooltip", source: null }]);
    expect(result.warnings).toEqual([]);
  });

  it("extracts a local function export", () => {
    const result = parseBarrel("export function Banner() { return null; }", "index.ts");
    expect(result.exports).toEqual([{ name: "Banner", source: null }]);
  });

  it("extracts a local class export", () => {
    const result = parseBarrel("export class Widget {}", "index.ts");
    expect(result.exports).toEqual([{ name: "Widget", source: null }]);
  });

  it("extracts a local TypeScript type export", () => {
    const result = parseBarrel("export type Variant = 'a' | 'b';", "index.ts");
    expect(result.exports).toEqual([{ name: "Variant", source: null }]);
  });

  it("extracts a named re-export", () => {
    const result = parseBarrel(`export { Button } from "./Button";`, "index.ts");
    expect(result.exports).toEqual([{ name: "Button", source: "./Button" }]);
  });

  it("extracts a default-as-named re-export", () => {
    const result = parseBarrel(`export { default as Card } from "./Card";`, "index.ts");
    expect(result.exports).toEqual([{ name: "Card", source: "./Card" }]);
  });

  it("extracts a renamed re-export", () => {
    const result = parseBarrel(`export { Modal as Dialog } from "./Modal";`, "index.ts");
    expect(result.exports).toEqual([{ name: "Dialog", source: "./Modal" }]);
  });

  it("warns on wildcard exports without producing an entry", () => {
    const result = parseBarrel(`export * from "./Forms";`, "index.ts");
    expect(result.exports).toEqual([]);
    expect(result.warnings).toEqual([{ code: "wildcard-export", detail: "./Forms" }]);
  });

  it("warns on default exports without producing an entry", () => {
    const result = parseBarrel("const Library = {}; export default Library;", "index.ts");
    expect(result.exports).toEqual([]);
    expect(result.warnings).toEqual([{ code: "default-export", detail: "" }]);
  });

  it("handles a realistic barrel with mixed shapes", () => {
    const source = [
      `export { Button } from "./Button";`,
      `export { default as Card } from "./Card";`,
      `export { Modal as Dialog } from "./Modal";`,
      `export const Tooltip = "tooltip";`,
      `export * from "./Forms";`,
      "export default function MyLib() {}",
    ].join("\n");

    const result = parseBarrel(source, "index.ts");

    expect(result.exports).toEqual([
      { name: "Button", source: "./Button" },
      { name: "Card", source: "./Card" },
      { name: "Dialog", source: "./Modal" },
      { name: "Tooltip", source: null },
    ]);
    expect(result.warnings).toEqual([
      { code: "wildcard-export", detail: "./Forms" },
      { code: "default-export", detail: "" },
    ]);
  });

  it("throws on a fatal parse error", () => {
    expect(() => parseBarrel("export { ", "index.ts")).toThrow(/Failed to parse/);
  });
});

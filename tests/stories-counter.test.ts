import { describe, expect, it } from "vitest";
import { countStories } from "../src/stories-counter.js";

describe("countStories", () => {
  it("returns 0 for an empty file", () => {
    expect(countStories("", "Button.stories.tsx")).toBe(0);
  });

  it("does not count the default export (CSF meta)", () => {
    const source = `
      const meta = { title: "Button" };
      export default meta;
    `;
    expect(countStories(source, "Button.stories.tsx")).toBe(0);
  });

  it("counts each named const export as one story", () => {
    const source = `
      export default { title: "Button" };
      export const Primary = { args: {} };
      export const Secondary = { args: {} };
    `;
    expect(countStories(source, "Button.stories.tsx")).toBe(2);
  });

  it("counts a named function export as one story", () => {
    const source = `
      export default { title: "Button" };
      export function Primary() { return null; }
    `;
    expect(countStories(source, "Button.stories.tsx")).toBe(1);
  });

  it("counts multiple declarators in a single export statement", () => {
    const source = `
      export default { title: "Button" };
      export const Primary = {}, Secondary = {}, Tertiary = {};
    `;
    expect(countStories(source, "Button.stories.tsx")).toBe(3);
  });

  it("counts named exports via specifier list", () => {
    const source = `
      const Primary = {};
      const Secondary = {};
      export default { title: "Button" };
      export { Primary, Secondary };
    `;
    expect(countStories(source, "Button.stories.tsx")).toBe(2);
  });

  it("excludes type-only specifiers from a mixed export list", () => {
    const source = `
      const Primary = {};
      type Variant = "a" | "b";
      export { Primary, type Variant };
    `;
    expect(countStories(source, "Button.stories.tsx")).toBe(1);
  });

  it("excludes `export type` aliases and interfaces", () => {
    const source = `
      export default {};
      export type Variant = "a" | "b";
      export interface Props { label: string; }
      export const Primary = {};
    `;
    expect(countStories(source, "Button.stories.tsx")).toBe(1);
  });

  it("excludes `export type { ... }` re-export blocks", () => {
    const source = `
      const Primary = {};
      export type { Variant } from "./types";
      export { Primary };
    `;
    expect(countStories(source, "Button.stories.tsx")).toBe(1);
  });

  it("parses both .ts and .tsx by file extension", () => {
    const source = `
      export default {};
      export const Primary = {};
    `;
    expect(countStories(source, "Button.stories.ts")).toBe(1);
    expect(countStories(source, "Button.stories.tsx")).toBe(1);
  });

  it("throws a descriptive error on a fatal parse error", () => {
    expect(() => countStories("export const Primary = (", "Broken.stories.tsx")).toThrow(
      /Failed to parse Broken\.stories\.tsx/,
    );
  });
});

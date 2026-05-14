import { describe, expect, it } from "vitest";
import { analyzeStories } from "../src/stories-counter.js";

const ZERO = { total: 0, csf1: 0, csf2: 0, csf3: 0, other: 0 };

describe("analyzeStories", () => {
  it("returns all zeros for an empty file", () => {
    expect(analyzeStories("", "Button.stories.tsx")).toEqual(ZERO);
  });

  it("does not count the default export (CSF meta)", () => {
    const source = `
      const meta = { title: "Button" };
      export default meta;
    `;
    expect(analyzeStories(source, "Button.stories.tsx")).toEqual(ZERO);
  });

  it("classifies object-shaped const exports as CSF3", () => {
    const source = `
      export default { title: "Button" };
      export const Primary = { args: {} };
      export const Secondary = { args: {} };
    `;
    expect(analyzeStories(source, "Button.stories.tsx")).toEqual({
      total: 2,
      csf1: 0,
      csf2: 0,
      csf3: 2,
      other: 0,
    });
  });

  it("classifies arrow-function exports as CSF2", () => {
    const source = `
      export default { title: "Button" };
      export const Primary = (args) => null;
      export const Secondary = (args) => null;
    `;
    expect(analyzeStories(source, "Button.stories.tsx")).toEqual({
      total: 2,
      csf1: 0,
      csf2: 2,
      csf3: 0,
      other: 0,
    });
  });

  it("classifies `function` declarations as CSF2", () => {
    const source = `
      export default { title: "Button" };
      export function Primary() { return null; }
    `;
    expect(analyzeStories(source, "Button.stories.tsx")).toEqual({
      total: 1,
      csf1: 0,
      csf2: 1,
      csf3: 0,
      other: 0,
    });
  });

  it("classifies storiesOf().add() chains as CSF1", () => {
    const source = `
      import { storiesOf } from "@storybook/react";
      storiesOf("Button", module)
        .add("Primary", () => null)
        .add("Secondary", () => null)
        .add("Tertiary", () => null);
    `;
    expect(analyzeStories(source, "Button.stories.tsx")).toEqual({
      total: 3,
      csf1: 3,
      csf2: 0,
      csf3: 0,
      other: 0,
    });
  });

  it("classifies a single storiesOf().add() as one CSF1 story", () => {
    const source = `
      import { storiesOf } from "@storybook/react";
      storiesOf("Button").add("Primary", () => null);
    `;
    expect(analyzeStories(source, "Button.stories.tsx").csf1).toBe(1);
  });

  it("does not count .add() calls on objects unrelated to storiesOf", () => {
    const source = `
      const set = new Set();
      set.add("nope");
    `;
    expect(analyzeStories(source, "Button.stories.tsx").csf1).toBe(0);
  });

  it("buckets a CallExpression-initialized export as `other`", () => {
    const source = `
      export default {};
      export const Primary = makeStory({ args: {} });
    `;
    expect(analyzeStories(source, "Button.stories.tsx")).toEqual({
      total: 1,
      csf1: 0,
      csf2: 0,
      csf3: 0,
      other: 1,
    });
  });

  it("classifies specifier-list exports via their local bindings", () => {
    const source = `
      const Primary = { args: {} };
      const Secondary = (args) => null;
      const Tertiary = makeStory();
      export default {};
      export { Primary, Secondary, Tertiary };
    `;
    expect(analyzeStories(source, "Button.stories.tsx")).toEqual({
      total: 3,
      csf1: 0,
      csf2: 1,
      csf3: 1,
      other: 1,
    });
  });

  it("excludes `export type` aliases and interfaces", () => {
    const source = `
      export default {};
      export type Variant = "a" | "b";
      export interface Props { label: string; }
      export const Primary = {};
    `;
    expect(analyzeStories(source, "Button.stories.tsx")).toEqual({
      total: 1,
      csf1: 0,
      csf2: 0,
      csf3: 1,
      other: 0,
    });
  });

  it("excludes type-only specifiers in a mixed export list", () => {
    const source = `
      const Primary = {};
      type Variant = "a" | "b";
      export { Primary, type Variant };
    `;
    expect(analyzeStories(source, "Button.stories.tsx").csf3).toBe(1);
  });

  it("handles mixed CSF2 and CSF3 in the same file", () => {
    const source = `
      export default {};
      export const Old = (args) => null;
      export const New = { args: {} };
      export const Stale = makeStory();
    `;
    expect(analyzeStories(source, "Button.stories.tsx")).toEqual({
      total: 3,
      csf1: 0,
      csf2: 1,
      csf3: 1,
      other: 1,
    });
  });

  it("parses both .ts and .tsx by file extension", () => {
    const source = "export default {}; export const Primary = {};";
    expect(analyzeStories(source, "Button.stories.ts").csf3).toBe(1);
    expect(analyzeStories(source, "Button.stories.tsx").csf3).toBe(1);
  });

  it("throws a descriptive error on a fatal parse error", () => {
    expect(() => analyzeStories("export const Primary = (", "Broken.stories.tsx")).toThrow(
      /Failed to parse Broken\.stories\.tsx/,
    );
  });

  it("guarantees csf1 + csf2 + csf3 + other === total", () => {
    const source = `
      import { storiesOf } from "@storybook/react";
      export default {};
      export const NewWay = { args: {} };
      export const OldWay = (args) => null;
      export const Weird = makeStory();
      storiesOf("Legacy").add("a", () => null).add("b", () => null);
    `;
    const result = analyzeStories(source, "Button.stories.tsx");
    expect(result.csf1 + result.csf2 + result.csf3 + result.other).toBe(result.total);
  });
});

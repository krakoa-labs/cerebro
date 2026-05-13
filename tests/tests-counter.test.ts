import { describe, expect, it } from "vitest";
import { countTests } from "../src/tests-counter.js";

describe("countTests", () => {
  it("returns zero counts for an empty file", () => {
    expect(countTests("", "x.test.ts")).toEqual({ total: 0, skipped: 0, only: 0 });
  });

  it("counts a single it() call", () => {
    expect(countTests(`it("a", () => {});`, "x.test.ts")).toEqual({
      total: 1,
      skipped: 0,
      only: 0,
    });
  });

  it("counts a single test() call", () => {
    expect(countTests(`test("a", () => {});`, "x.test.ts")).toEqual({
      total: 1,
      skipped: 0,
      only: 0,
    });
  });

  it("counts it.skip() as both total and skipped", () => {
    expect(countTests(`it.skip("a", () => {});`, "x.test.ts")).toEqual({
      total: 1,
      skipped: 1,
      only: 0,
    });
  });

  it("counts it.todo() as both total and skipped", () => {
    expect(countTests(`it.todo("a");`, "x.test.ts")).toEqual({
      total: 1,
      skipped: 1,
      only: 0,
    });
  });

  it("counts it.only() as both total and only", () => {
    expect(countTests(`it.only("a", () => {});`, "x.test.ts")).toEqual({
      total: 1,
      skipped: 0,
      only: 1,
    });
  });

  it("counts test.skip() as both total and skipped", () => {
    expect(countTests(`test.skip("a", () => {});`, "x.test.ts")).toEqual({
      total: 1,
      skipped: 1,
      only: 0,
    });
  });

  it("counts it.each([...])(...) as a single test, not the array length", () => {
    expect(countTests(`it.each([1, 2, 3])("a %s", () => {});`, "x.test.ts")).toEqual({
      total: 1,
      skipped: 0,
      only: 0,
    });
  });

  it("counts it.skip.each([...])(...) as a single skipped test", () => {
    expect(countTests(`it.skip.each([1, 2])("a %s", () => {});`, "x.test.ts")).toEqual({
      total: 1,
      skipped: 1,
      only: 0,
    });
  });

  it("does not count describe() blocks but counts the it()s inside them", () => {
    const source = `
      describe("group", () => {
        it("a", () => {});
        it("b", () => {});
      });
    `;
    expect(countTests(source, "x.test.ts")).toEqual({ total: 2, skipped: 0, only: 0 });
  });

  it("does not count unrelated function calls", () => {
    const source = `
      expect(1).toBe(1);
      console.log("hi");
      customFn();
    `;
    expect(countTests(source, "x.test.ts")).toEqual({ total: 0, skipped: 0, only: 0 });
  });

  it("aggregates a realistic test file", () => {
    const source = `
      import { describe, it } from "vitest";

      describe("Button", () => {
        it("renders", () => {});
        it("handles click", () => {});
        it.skip("supports drag", () => {});
        it.only("focused test", () => {});
        it.todo("future test");
      });
    `;
    expect(countTests(source, "x.test.ts")).toEqual({ total: 5, skipped: 2, only: 1 });
  });

  it("throws on a fatal parse error", () => {
    expect(() => countTests("it.skip(", "x.test.ts")).toThrow(/Failed to parse/);
  });
});

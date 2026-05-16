import { describe, expect, it } from "vitest";
import { detectDeprecation } from "../src/deprecation-detector.js";
import { parseSource } from "../src/parse-source.js";

const parse = (src: string) => parseSource(src, "Button.tsx");

describe("detectDeprecation — named lookup", () => {
  it("flags a JSDoc on an inline-exported const", () => {
    const src = "/** @deprecated */\nexport const Button = () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(true);
  });

  it("flags a JSDoc on an inline-exported function", () => {
    const src = "/** @deprecated */\nexport function Button() { return null; }\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(true);
  });

  it("flags a JSDoc on an inline-exported class", () => {
    const src = "/** @deprecated */\nexport class Button {}\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(true);
  });

  it("flags a JSDoc on a standalone const that is exported separately", () => {
    const src = "/** @deprecated */\nconst Button = () => null;\nexport { Button };\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(true);
  });

  it("returns false when the declaration carries no JSDoc", () => {
    const src = "export const Button = () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(false);
  });

  it("returns false when the JSDoc has no @deprecated tag", () => {
    const src = "/** Some other doc. */\nexport const Button = () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(false);
  });

  it("preserves the @deprecated message in detection (still true)", () => {
    const src = "/** @deprecated Use NewButton instead. */\nexport const Button = () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(true);
  });

  it("requires a strict JSDoc opener — '/*' (single asterisk) does not count", () => {
    const src = "/* @deprecated */\nexport const Button = () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(false);
  });

  it("requires a block comment — '// @deprecated' does not count", () => {
    const src = "// @deprecated\nexport const Button = () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(false);
  });

  it("ignores a JSDoc detached from the declaration by another statement", () => {
    const src = "/** @deprecated */\nconst Other = 1;\nexport const Button = () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(false);
  });

  it("returns false when no declaration matches the lookup name", () => {
    const src = "/** @deprecated */\nexport const Card = () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(false);
  });

  it("does not match @deprecatedSomething as the bare @deprecated tag", () => {
    const src = "/** @deprecatedSoon */\nexport const Button = () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(false);
  });

  it("flags a multi-line JSDoc with @deprecated on its own line", () => {
    const src = [
      "/**",
      " * Renders a primary button.",
      " * @deprecated Use NewButton instead.",
      " */",
      "export const Button = () => null;",
    ].join("\n");
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(true);
  });

  it("does not flag @deprecated when it only appears inside another tag's body", () => {
    const src = `/** @example "{@deprecated foo}" — see deprecation rules. */\nexport const Button = () => null;\n`;
    expect(detectDeprecation(parse(src), { kind: "named", name: "Button" })).toBe(false);
  });

  it("flags every binding when a multi-declarator statement shares one @deprecated JSDoc", () => {
    const src = "/** @deprecated */\nexport const A = 1, B = 2;\n";
    expect(detectDeprecation(parse(src), { kind: "named", name: "A" })).toBe(true);
    expect(detectDeprecation(parse(src), { kind: "named", name: "B" })).toBe(true);
  });
});

describe("detectDeprecation — default lookup", () => {
  it("flags a JSDoc on a standalone const exported by `export default`", () => {
    const src = "/** @deprecated */\nconst Card = 'card';\nexport default Card;\n";
    expect(detectDeprecation(parse(src), { kind: "default" })).toBe(true);
  });

  it("flags a JSDoc on `export default function Foo() {}`", () => {
    const src = "/** @deprecated */\nexport default function Card() { return null; }\n";
    expect(detectDeprecation(parse(src), { kind: "default" })).toBe(true);
  });

  it("returns false on `export default forwardRef(...)` (no traceable declaration)", () => {
    const src =
      "/** @deprecated */\nconst Inner = () => null;\nexport default forwardRef(Inner);\n";
    expect(detectDeprecation(parse(src), { kind: "default" })).toBe(false);
  });

  it("returns false on an inline anonymous default export", () => {
    const src = "/** @deprecated */\nexport default () => null;\n";
    expect(detectDeprecation(parse(src), { kind: "default" })).toBe(false);
  });

  it("returns false when no default export exists", () => {
    const src = "/** @deprecated */\nconst Card = 'card';\n";
    expect(detectDeprecation(parse(src), { kind: "default" })).toBe(false);
  });
});

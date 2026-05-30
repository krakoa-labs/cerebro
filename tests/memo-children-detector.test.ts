import { describe, expect, it } from "vitest";
import { detectMemoWithChildren } from "../src/memo-children-detector.js";
import { parseSource } from "../src/parse-source.js";

const named = { kind: "named", name: "Button" } as const;
const parse = (src: string) => parseSource(src, "Button.tsx");

describe("detectMemoWithChildren — fires (named lookup)", () => {
  it.each([
    [
      "inline object children typed ReactNode",
      "export const Button = memo((props: { children: ReactNode }) => null);",
    ],
    [
      "destructured inline children typed ReactNode",
      "export const Button = memo(({ children }: { children: ReactNode }) => null);",
    ],
    [
      "a same-file interface with ReactNode children",
      "interface P { children: ReactNode }\nexport const Button = memo((props: P) => null);",
    ],
    [
      "an exported same-file interface with ReactNode children",
      "export interface P { children: ReactNode }\nexport const Button = memo((props: P) => null);",
    ],
    [
      "a same-file type alias with ReactElement children",
      "type P = { children: ReactElement };\nexport const Button = memo((props: P) => null);",
    ],
    [
      "the memo type argument",
      "interface P { children: ReactNode }\nexport const Button = memo<P>((props) => null);",
    ],
    [
      "React.memo qualified",
      "interface P { children: ReactNode }\nexport const Button = React.memo((props: P) => null);",
    ],
    [
      "memo wrapping forwardRef with a props type argument",
      "interface P { children: ReactNode }\nexport const Button = memo(forwardRef<HTMLDivElement, P>((props, ref) => null));",
    ],
    [
      "memo wrapping forwardRef with an annotated inner parameter",
      "interface P { children: ReactNode }\nexport const Button = memo(forwardRef((props: P, ref) => null));",
    ],
    [
      "children typed as an array of elements",
      "interface P { children: ReactNode[] }\nexport const Button = memo((props: P) => null);",
    ],
    [
      "children typed React.ReactNode (qualified)",
      "interface P { children: React.ReactNode }\nexport const Button = memo((props: P) => null);",
    ],
    [
      "children typed JSX.Element (qualified)",
      "interface P { children: JSX.Element }\nexport const Button = memo((props: P) => null);",
    ],
    [
      "optional children typed ReactNode",
      "interface P { children?: ReactNode }\nexport const Button = memo((props: P) => null);",
    ],
  ])("flags %s", (_label, src) => {
    expect(detectMemoWithChildren(parse(src), named)).toBe(true);
  });
});

describe("detectMemoWithChildren — fires (memo wrapping a named component)", () => {
  it.each([
    [
      "a named function component with a same-file interface",
      "interface P { children: ReactNode }\nconst Base = (props: P) => null;\nexport const Button = memo(Base);",
    ],
    [
      "a named forwardRef component with a props type argument",
      "type P = { children: ReactNode };\nconst Base = forwardRef<HTMLDivElement, P>((props, ref) => null);\nexport const Button = memo(Base);",
    ],
    [
      "a named forwardRef component with an annotated inner parameter",
      "interface P { children: ReactNode }\nconst Base = forwardRef((props: P, ref) => null);\nexport const Button = memo(Base);",
    ],
    [
      "a named FC component",
      "interface P { children: ReactNode }\nconst Base: FC<P> = (props) => null;\nexport const Button = memo(Base);",
    ],
    [
      "a named React.FC component",
      "interface P { children: ReactNode }\nconst Base: React.FC<P> = (props) => null;\nexport const Button = memo(Base);",
    ],
    [
      "a memo call behind an as-cast",
      "interface P { children: ReactNode }\nconst Base = (props: P) => null;\nexport const Button = memo(Base) as MemoComponent<P>;",
    ],
    [
      "an inline memo behind an as-cast",
      "export const Button = memo((props: { children: ReactNode }) => null) as MemoComponent;",
    ],
  ])("flags %s", (_label, src) => {
    expect(detectMemoWithChildren(parse(src), named)).toBe(true);
  });
});

describe("detectMemoWithChildren — fires (memo applied to a binding at its export)", () => {
  const base = { kind: "named", name: "Base" } as const;

  it.each([
    [
      "a function component memoized by a default export",
      "interface P { children: ReactNode }\nconst Base = (props: P) => null;\nexport default memo(Base);",
    ],
    [
      "a forwardRef component memoized by a default export",
      "type P = { children: ReactNode };\nconst Base = forwardRef<HTMLDivElement, P>((props, ref) => null);\nexport default memo(Base);",
    ],
    [
      "a binding memoized into a separate named export",
      "interface P { children: ReactNode }\nconst Base = (props: P) => null;\nexport const Memoized = memo(Base);",
    ],
  ])("flags %s", (_label, src) => {
    expect(detectMemoWithChildren(parse(src), base)).toBe(true);
  });

  it.each([
    [
      "a binding exported without memo",
      "interface P { children: ReactNode }\nconst Base = (props: P) => null;\nexport default Base;",
    ],
    [
      "a binding memoized with a custom comparator",
      "interface P { children: ReactNode }\nconst Base = (props: P) => null;\nexport default memo(Base, (a, b) => true);",
    ],
    [
      "a memoized binding whose children are a bare string",
      "interface P { children: string }\nconst Base = (props: P) => null;\nexport default memo(Base);",
    ],
  ])("does not flag %s", (_label, src) => {
    expect(detectMemoWithChildren(parse(src), base)).toBe(false);
  });
});

describe("detectMemoWithChildren — does not fire (named component resolution)", () => {
  it.each([
    [
      "a named component whose children are a bare string",
      "interface P { children: string }\nconst Base = (props: P) => null;\nexport const Button = memo(Base);",
    ],
    [
      "a memo over an identifier declared in another module",
      "export const Button = memo(External);",
    ],
    [
      "a comparator behind an as-cast",
      "interface P { children: ReactNode }\nconst Base = (props: P) => null;\nexport const Button = memo(Base, (a, b) => true) as MemoComponent<P>;",
    ],
    ["a self-referential memo binding", "export const Button = memo(Button);"],
  ])("does not flag %s", (_label, src) => {
    expect(detectMemoWithChildren(parse(src), named)).toBe(false);
  });
});

describe("detectMemoWithChildren — does not fire (named lookup)", () => {
  it.each([
    [
      "children typed as a bare string",
      "interface P { children: string }\nexport const Button = memo((props: P) => null);",
    ],
    [
      "children typed as a bare number",
      "export const Button = memo((props: { children: number }) => null);",
    ],
    [
      "children typed as the DOM Element, not a React node",
      "interface P { children: Element }\nexport const Button = memo((props: P) => null);",
    ],
    [
      "a union children type (under-flagged, the quiet direction)",
      "interface P { children: ReactNode | string }\nexport const Button = memo((props: P) => null);",
    ],
    [
      "a custom comparator opting into bespoke equality",
      "interface P { children: ReactNode }\nexport const Button = memo((props: P) => null, (a, b) => true);",
    ],
    [
      "no memo wrapper",
      "interface P { children: ReactNode }\nexport const Button = (props: P) => null;",
    ],
    [
      "a forwardRef wrapper without memo",
      "interface P { children: ReactNode }\nexport const Button = forwardRef((props: P, ref) => null);",
    ],
    ["untyped props", "export const Button = memo((props) => null);"],
    ["no props at all", "export const Button = memo(() => null);"],
    [
      "props with no children member",
      "interface P { title: string }\nexport const Button = memo((props: P) => null);",
    ],
    [
      "a props type not declared in this file",
      "export const Button = memo((props: ExternalProps) => null);",
    ],
    [
      "memo over a referenced component, props untraced here",
      "const Inner = (props: P) => null;\nexport const Button = memo(Inner);",
    ],
  ])("does not flag %s", (_label, src) => {
    expect(detectMemoWithChildren(parse(src), named)).toBe(false);
  });

  it.each([
    ["a non-function value", "export const Button = 1;"],
    ["a class component", "export class Button {}"],
    ["a bare re-export from another module", `export { Button } from "./impl";`],
    ["an empty file", ""],
  ])("does not flag %s", (_label, src) => {
    expect(detectMemoWithChildren(parse(src), named)).toBe(false);
  });

  it("returns false when no declaration matches the lookup name", () => {
    const src =
      "interface P { children: ReactNode }\nexport const Card = memo((props: P) => null);";
    expect(detectMemoWithChildren(parse(src), named)).toBe(false);
  });
});

describe("detectMemoWithChildren — default lookup", () => {
  const dflt = { kind: "default" } as const;

  it("flags an inline default-exported memo with element children", () => {
    const src = "export default memo((props: { children: ReactNode }) => null);";
    expect(detectMemoWithChildren(parse(src), dflt)).toBe(true);
  });

  it("flags a default-exported memo wrapping a named component", () => {
    const src =
      "interface P { children: ReactNode }\nconst Base = (props: P) => null;\nexport default memo(Base);";
    expect(detectMemoWithChildren(parse(src), dflt)).toBe(true);
  });

  it("flags a default export that references a local memo binding", () => {
    const src =
      "interface P { children: ReactNode }\nconst Button = memo((props: P) => null);\nexport default Button;";
    expect(detectMemoWithChildren(parse(src), dflt)).toBe(true);
  });

  it("does not flag a default-exported memo with string children", () => {
    const src = "export default memo((props: { children: string }) => null);";
    expect(detectMemoWithChildren(parse(src), dflt)).toBe(false);
  });

  it("returns false when there is no default export", () => {
    const src = "export const Button = memo((props: { children: ReactNode }) => null);";
    expect(detectMemoWithChildren(parse(src), dflt)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { parseSource } from "../src/parse-source.js";
import { detectPropsTyping } from "../src/props-typing-detector.js";

const named = { kind: "named", name: "Button" } as const;
const parse = (src: string) => parseSource(src, "Button.tsx");

describe("detectPropsTyping — typed (named lookup)", () => {
  it.each([
    ["function declaration with an annotated parameter", "export function Button(props: P) {}"],
    ["arrow with an annotated parameter", "export const Button = (props: P) => null;"],
    ["destructured annotated parameter", "export const Button = ({ a }: P) => null;"],
    ["inline object-literal annotation", "export const Button = (props: { a: string }) => null;"],
    [
      "function expression with an annotated parameter",
      "export const Button = function (props: P) {};",
    ],
    ["FC with a props type argument", "export const Button: FC<P> = (props) => null;"],
    ["React.FC with a props type argument", "export const Button: React.FC<P> = (props) => null;"],
    [
      "FunctionComponent with a props type argument",
      "export const Button: FunctionComponent<P> = (props) => null;",
    ],
    ["a bare FC annotation", "export const Button: FC = (props) => null;"],
    [
      "forwardRef with a props type argument",
      "export const Button = forwardRef<HTMLDivElement, P>((props, ref) => null);",
    ],
    [
      "React.forwardRef with a props type argument",
      "export const Button = React.forwardRef<HTMLDivElement, P>((props, ref) => null);",
    ],
    [
      "forwardRef with an annotated inner parameter",
      "export const Button = forwardRef((props: P, ref) => null);",
    ],
    ["memo with a props type argument", "export const Button = memo<P>((props) => null);"],
    ["memo with an annotated inner parameter", "export const Button = memo((props: P) => null);"],
    ["a parameter annotated as any", "export const Button = (props: any) => null;"],
    [
      "a defaulted parameter annotated on its left-hand side",
      "export const Button = (props: P = {}) => null;",
    ],
  ])("classifies %s as typed", (_label, src) => {
    expect(detectPropsTyping(parse(src), named)).toBe("typed");
  });

  it("treats a function component that accepts no props as typed", () => {
    expect(detectPropsTyping(parse("export function Button() {}"), named)).toBe("typed");
    expect(detectPropsTyping(parse("export const Button = () => null;"), named)).toBe("typed");
  });

  it("resolves a standalone declaration exported separately", () => {
    const src = "function Button(props: P) {}\nexport { Button };\n";
    expect(detectPropsTyping(parse(src), named)).toBe("typed");
  });
});

describe("detectPropsTyping — untyped (named lookup)", () => {
  it.each([
    ["an arrow with an unannotated parameter", "export const Button = (props) => null;"],
    ["a function declaration with an unannotated parameter", "export function Button(props) {}"],
    ["a destructured unannotated parameter", "export const Button = ({ a }) => null;"],
    [
      "forwardRef with an unannotated inner parameter",
      "export const Button = forwardRef((props, ref) => null);",
    ],
    ["memo with an unannotated inner parameter", "export const Button = memo((props) => null);"],
    [
      "forwardRef typing only the ref, not the props",
      "export const Button = forwardRef<HTMLDivElement>((props, ref) => null);",
    ],
    ["a defaulted parameter with no annotation", "export const Button = (props = {}) => null;"],
  ])("classifies %s as untyped", (_label, src) => {
    expect(detectPropsTyping(parse(src), named)).toBe("untyped");
  });
});

describe("detectPropsTyping — unanalyzed (named lookup)", () => {
  it("classifies a class component as unanalyzed", () => {
    const src = "export class Button extends Component<P> { render() { return null; } }";
    expect(detectPropsTyping(parse(src), named)).toBe("unanalyzed");
  });

  it.each([
    ["a barrel-local string constant", `export const Button = "button";`],
    ["a non-function value", "export const Button = 1;"],
  ])("classifies %s as unanalyzed", (_label, src) => {
    expect(detectPropsTyping(parse(src), named)).toBe("unanalyzed");
  });

  it("classifies a deeply-wrapped HOC over an identifier as unanalyzed", () => {
    const src = "const Inner = (props) => null;\nexport const Button = withTheme(Inner);\n";
    expect(detectPropsTyping(parse(src), named)).toBe("unanalyzed");
  });

  it("classifies an unrecognized variable annotation with an unannotated parameter as unanalyzed", () => {
    const src = "export const Button: ComponentType = (props) => null;";
    expect(detectPropsTyping(parse(src), named)).toBe("unanalyzed");
  });

  it("still resolves an unrecognized variable annotation when the parameter is annotated", () => {
    const src = "export const Button: ComponentType = (props: P) => null;";
    expect(detectPropsTyping(parse(src), named)).toBe("typed");
  });

  it("returns unanalyzed when no declaration matches the lookup name", () => {
    const src = "export const Card = (props: P) => null;";
    expect(detectPropsTyping(parse(src), named)).toBe("unanalyzed");
  });

  it("returns unanalyzed for a bare re-export from another module", () => {
    const src = `export { Button } from "./impl";`;
    expect(detectPropsTyping(parse(src), named)).toBe("unanalyzed");
  });

  it("returns unanalyzed for an empty file", () => {
    expect(detectPropsTyping(parse(""), named)).toBe("unanalyzed");
  });
});

describe("detectPropsTyping — default lookup", () => {
  const dflt = { kind: "default" } as const;

  it("classifies a typed default-exported function declaration as typed", () => {
    const src = "export default function Button(props: P) {}";
    expect(detectPropsTyping(parse(src), dflt)).toBe("typed");
  });

  it("classifies a typed anonymous default-exported arrow as typed", () => {
    const src = "export default (props: P) => null;";
    expect(detectPropsTyping(parse(src), dflt)).toBe("typed");
  });

  it("resolves a default export that references a local binding", () => {
    const src = "const Button = (props: P) => null;\nexport default Button;\n";
    expect(detectPropsTyping(parse(src), dflt)).toBe("typed");
  });

  it("classifies an untyped anonymous default-exported arrow as untyped", () => {
    expect(detectPropsTyping(parse("export default (props) => null;"), dflt)).toBe("untyped");
  });

  it("classifies a default-exported class component as unanalyzed", () => {
    const src = "export default class extends Component<P> { render() { return null; } }";
    expect(detectPropsTyping(parse(src), dflt)).toBe("unanalyzed");
  });

  it("returns unanalyzed when there is no default export", () => {
    const src = "export const Button = (props: P) => null;";
    expect(detectPropsTyping(parse(src), dflt)).toBe("unanalyzed");
  });
});

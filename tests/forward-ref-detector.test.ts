import { describe, expect, it } from "vitest";
import { detectForwardRefWithoutRef } from "../src/forward-ref-detector.js";
import { parseSource } from "../src/parse-source.js";

const named = { kind: "named", name: "Field" } as const;
const parse = (src: string) => parseSource(src, "Field.tsx");

describe("detectForwardRefWithoutRef — fires", () => {
  it.each([
    [
      "a declared ref parameter never used",
      "export const Field = forwardRef((props, ref) => <input />);",
    ],
    ["no ref parameter at all", "export const Field = forwardRef((props) => <input />);"],
    ["no parameters at all", "export const Field = forwardRef(() => <input />);"],
    [
      "an underscore-named ref that is never used",
      "export const Field = forwardRef((props, _ref) => <input />);",
    ],
    [
      "a block-body render function that never uses the ref",
      "export const Field = forwardRef((props, ref) => { const x = 1; return <input value={x} />; });",
    ],
    [
      "the ref typed but unused",
      "export const Field = forwardRef<HTMLInputElement, Props>((props, ref) => <input />);",
    ],
    [
      "a memo-wrapped forwardRef dropping its ref",
      "export const Field = memo(forwardRef((props, ref) => <input />));",
    ],
    [
      "a cast forwardRef dropping its ref",
      "export const Field = forwardRef((props, ref) => <input />) as FieldComponent;",
    ],
    [
      "forwardRef following a same-file binding that drops the ref",
      "const render = (props, ref) => <input />;\nexport const Field = forwardRef(render);",
    ],
    [
      "the export-binding shape dropping the ref",
      "const Field = (props, ref) => <input />;\nexport default forwardRef(Field);",
    ],
  ])("flags %s", (_label, src) => {
    expect(detectForwardRefWithoutRef(parse(src), named)).toBe(true);
  });

  it("flags the export-binding shape via the default lookup", () => {
    const src = "const Field = (props, ref) => <input />;\nexport default forwardRef(Field);";
    expect(detectForwardRefWithoutRef(parse(src), { kind: "default" })).toBe(true);
  });
});

describe("detectForwardRefWithoutRef — stays quiet", () => {
  it.each([
    [
      "the ref forwarded to JSX",
      "export const Field = forwardRef((props, ref) => <input ref={ref} />);",
    ],
    [
      "the ref read through useImperativeHandle",
      "export const Field = forwardRef((props, ref) => { useImperativeHandle(ref, () => ({})); return <input />; });",
    ],
    [
      "the ref used inside an effect",
      "export const Field = forwardRef((props, ref) => { useEffect(() => { ref.current?.focus(); }); return <input />; });",
    ],
    [
      "the ref passed to a child inside a callback",
      "export const Field = forwardRef((props, ref) => items.map(() => <Child ref={ref} />));",
    ],
    [
      "the ref spread onto an element",
      "export const Field = forwardRef((props, ref) => <input {...{ ref }} />);",
    ],
    ["a plain component with no forwardRef", "export const Field = (props, ref) => <input />;"],
    [
      "a memo-only component with no forwardRef",
      "export const Field = memo((props) => <input />);",
    ],
    [
      "a class component",
      "export class Field extends Component { render() { return <input />; } }",
    ],
  ])("does not flag %s", (_label, src) => {
    expect(detectForwardRefWithoutRef(parse(src), named)).toBe(false);
  });

  it("does not flag when the export cannot be resolved in this file", () => {
    const src = "export { Field } from './elsewhere';";
    expect(detectForwardRefWithoutRef(parse(src), named)).toBe(false);
  });
});

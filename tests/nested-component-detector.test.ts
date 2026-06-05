import { describe, expect, it } from "vitest";
import { detectNestedComponentDefinition } from "../src/nested-component-detector.js";
import { parseSource } from "../src/parse-source.js";

const named = { kind: "named", name: "Panel" } as const;
const parse = (src: string) => parseSource(src, "Panel.tsx");

describe("detectNestedComponentDefinition — fires", () => {
  it.each([
    [
      "an arrow component declared in the render body",
      "export const Panel = () => { const Row = () => <tr/>; return <table><Row/></table>; };",
    ],
    [
      "a function declaration in the render body",
      "export const Panel = () => { function Row() { return <tr/>; } return <Row/>; };",
    ],
    [
      "a function-expression component in the render body",
      "export const Panel = () => { const Row = function () { return <tr/>; }; return <Row/>; };",
    ],
    [
      "a nested component returning JSX through a ternary",
      "export const Panel = () => { const Row = () => (cond ? <a/> : <b/>); return <Row/>; };",
    ],
    [
      "a nested component returning JSX through a logical and",
      "export const Panel = () => { const Row = () => show && <a/>; return <Row/>; };",
    ],
    [
      "a nested component hidden inside a conditional branch",
      "export const Panel = () => { if (open) { const Tip = () => <p/>; } return null; };",
    ],
    [
      "a nested component hidden inside a callback",
      "export const Panel = () => items.map(() => { const Cell = () => <td/>; return <Cell/>; });",
    ],
    [
      "a memo-wrapped nested component",
      "export const Panel = () => { const Row = memo(() => <tr/>); return <Row/>; };",
    ],
    [
      "a forwardRef-wrapped nested component",
      "export const Panel = () => { const Row = forwardRef((p, ref) => <tr/>); return <Row/>; };",
    ],
    [
      "a nested component in a function-declaration outer",
      "export function Panel() { const Row = () => <tr/>; return <Row/>; }",
    ],
    [
      "a nested component in a memo-wrapped outer",
      "const Base = () => { const Row = () => <tr/>; return <Row/>; };\nexport const Panel = memo(Base);",
    ],
    [
      "a nested component in a forwardRef outer",
      "export const Panel = forwardRef((props, ref) => { const Row = () => <tr/>; return <Row/>; });",
    ],
  ])("flags %s", (_label, src) => {
    expect(detectNestedComponentDefinition(parse(src), named)).toBe(true);
  });

  it.each([
    [
      "an inline arrow default export",
      "export default () => { const Row = () => <tr/>; return <Row/>; };",
    ],
    [
      "a default export resolved through a binding",
      "const Base = () => { const Row = () => <tr/>; return <Row/>; };\nexport default Base;",
    ],
  ])("flags %s via the default lookup", (_label, src) => {
    expect(detectNestedComponentDefinition(parse(src), { kind: "default" })).toBe(true);
  });
});

describe("detectNestedComponentDefinition — stays quiet", () => {
  it.each([
    ["no nested declaration at all", "export const Panel = () => <div><span/></div>;"],
    [
      "a camelCase helper returning JSX (not a component by convention)",
      "export const Panel = () => { const renderRow = () => <tr/>; return renderRow(); };",
    ],
    [
      "a PascalCase nested const that is not a function",
      "export const Panel = () => { const Total = 42; return <div>{Total}</div>; };",
    ],
    [
      "a PascalCase nested function that returns no JSX",
      "export const Panel = () => { const Compute = () => 42; return <div>{Compute()}</div>; };",
    ],
    [
      "a sibling component declared at module scope, not inside the body",
      "const Row = () => <tr/>;\nexport const Panel = () => <table><Row/></table>;",
    ],
    [
      "JSX produced only inside a nested callback, not returned by the helper",
      "export const Panel = () => { const Build = () => items.map((x) => <li/>); return <div/>; };",
    ],
    [
      "a class component (not resolved to a function)",
      "export class Panel extends Component { render() { const Row = () => <tr/>; return <Row/>; } }",
    ],
    [
      "a styled-component factory in the render body (not a function-returning-JSX)",
      "export const Panel = () => { const Box = styled.div``; return <Box/>; };",
    ],
  ])("does not flag %s", (_label, src) => {
    expect(detectNestedComponentDefinition(parse(src), named)).toBe(false);
  });

  it("does not flag when the export cannot be resolved in this file", () => {
    const src = "export { Panel } from './elsewhere';";
    expect(detectNestedComponentDefinition(parse(src), named)).toBe(false);
  });

  it("does not misjudge an outer whose own return is non-JSX by a nested JSX helper", () => {
    // `helper` returns JSX, but `Panel` itself returns a number — the helper is
    // camelCase, so it is not a component, and its return must not lift Panel.
    const src = "export const Panel = () => { const helper = () => <i/>; return compute(); };";
    expect(detectNestedComponentDefinition(parse(src), named)).toBe(false);
  });
});

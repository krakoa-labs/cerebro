import { describe, expect, it } from "vitest";
import { detectDefinitionKind } from "../src/definition-kind-detector.js";
import { parseSource } from "../src/parse-source.js";

const named = { kind: "named", name: "Button" } as const;
const parse = (src: string) => parseSource(src, "Button.tsx");

describe("detectDefinitionKind — class (named lookup)", () => {
  it.each([
    ["a class extending Component", "export class Button extends Component { render() {} }"],
    [
      "a class extending React.Component",
      "export class Button extends React.Component { render() {} }",
    ],
    [
      "a class extending PureComponent",
      "export class Button extends PureComponent { render() {} }",
    ],
    [
      "a class extending React.PureComponent",
      "export class Button extends React.PureComponent { render() {} }",
    ],
    [
      "a class expression extending Component",
      "export const Button = class extends Component { render() {} };",
    ],
    [
      "a memo wrapper around an inline class",
      "export const Button = memo(class extends Component { render() {} });",
    ],
  ])("classifies %s as class", (_label, src) => {
    expect(detectDefinitionKind(parse(src), named)).toBe("class");
  });

  it("resolves a standalone class exported separately", () => {
    const src = "class Button extends Component { render() {} }\nexport { Button };\n";
    expect(detectDefinitionKind(parse(src), named)).toBe("class");
  });

  it("follows a memo wrapper around a local class identifier", () => {
    const src =
      "class ButtonBase extends Component { render() {} }\n" +
      "export const Button = memo(ButtonBase);\n";
    expect(detectDefinitionKind(parse(src), named)).toBe("class");
  });
});

describe("detectDefinitionKind — function (named lookup)", () => {
  it.each([
    ["a function declaration", "export function Button() { return null; }"],
    ["an arrow function", "export const Button = () => null;"],
    ["a function expression", "export const Button = function () { return null; };"],
    ["a forwardRef wrapper", "export const Button = forwardRef((props, ref) => null);"],
    ["a React.forwardRef wrapper", "export const Button = React.forwardRef((props, ref) => null);"],
    ["a memo wrapper", "export const Button = memo((props) => null);"],
    ["a React.memo wrapper", "export const Button = React.memo((props) => null);"],
    [
      "a memo wrapper around a forwardRef wrapper",
      "export const Button = memo(forwardRef((props, ref) => null));",
    ],
    [
      "a forwardRef wrapper behind an as-cast",
      "export const Button = forwardRef((props, ref) => null) as Foo;",
    ],
    [
      "a memo wrapper behind a satisfies-cast",
      "export const Button = memo((props) => null) satisfies Foo;",
    ],
    [
      "a forwardRef wrapper behind a non-null assertion",
      "export const Button = forwardRef((props, ref) => null)!;",
    ],
  ])("classifies %s as function", (_label, src) => {
    expect(detectDefinitionKind(parse(src), named)).toBe("function");
  });

  it("follows a memo wrapper around a cast forwardRef binding", () => {
    const src =
      "const ButtonBase = forwardRef((props, ref) => null) as Foo;\n" +
      "export const Button = memo(ButtonBase) as Bar;\n";
    expect(detectDefinitionKind(parse(src), named)).toBe("function");
  });

  it("resolves a standalone function exported separately", () => {
    const src = "function Button() { return null; }\nexport { Button };\n";
    expect(detectDefinitionKind(parse(src), named)).toBe("function");
  });

  it("follows a memo wrapper around a local function identifier", () => {
    const src =
      "function ButtonBase() { return null; }\n" + "export const Button = memo(ButtonBase);\n";
    expect(detectDefinitionKind(parse(src), named)).toBe("function");
  });
});

describe("detectDefinitionKind — other (named lookup)", () => {
  it.each([
    ["a string constant", `export const Button = "button";`],
    ["a numeric constant", "export const Button = 1;"],
    ["an object literal", "export const Button = {};"],
    ["a styled-components tagged template", "export const Button = styled.div`color: red;`;"],
    ["an HOC call", "export const Button = withRouter(ButtonBase);"],
    ["a curried HOC call", "export const Button = connect(mapState)(ButtonBase);"],
    ["a class with no base class", "export class Button {}"],
    [
      "a class extending an unrecognized base",
      "export class Button extends BaseWidget { render() {} }",
    ],
  ])("classifies %s as other", (_label, src) => {
    expect(detectDefinitionKind(parse(src), named)).toBe("other");
  });

  it("classifies a memo wrapper around a non-local identifier as other", () => {
    const src = "export const Button = memo(ImportedBase);";
    expect(detectDefinitionKind(parse(src), named)).toBe("other");
  });

  it("classifies a self-referential memo wrapper as other without recursing forever", () => {
    const src = "export const Button = memo(Button);";
    expect(detectDefinitionKind(parse(src), named)).toBe("other");
  });
});

describe("detectDefinitionKind — unanalyzed (named lookup)", () => {
  it.each([
    ["an empty file", ""],
    ["a file with no matching declaration", "export const Card = () => null;"],
    ["a bare re-export from another module", `export { Button } from "./impl";`],
    ["a type alias declaration", "export type Button = string;"],
  ])("classifies %s as unanalyzed", (_label, src) => {
    expect(detectDefinitionKind(parse(src), named)).toBe("unanalyzed");
  });
});

describe("detectDefinitionKind — default lookup", () => {
  const dflt = { kind: "default" } as const;

  it.each([
    ["a default-exported function declaration", "export default function Button() {}"],
    ["a default-exported anonymous arrow", "export default () => null;"],
    ["a default-exported memo wrapper", "export default memo((props) => null);"],
  ])("classifies %s as function", (_label, src) => {
    expect(detectDefinitionKind(parse(src), dflt)).toBe("function");
  });

  it.each([
    [
      "a default-exported anonymous class",
      "export default class extends Component { render() {} }",
    ],
    [
      "a default-exported named class extending React.Component",
      "export default class Button extends React.Component { render() {} }",
    ],
  ])("classifies %s as class", (_label, src) => {
    expect(detectDefinitionKind(parse(src), dflt)).toBe("class");
  });

  it("resolves a default export that references a local function", () => {
    const src = "const Button = () => null;\nexport default Button;\n";
    expect(detectDefinitionKind(parse(src), dflt)).toBe("function");
  });

  it("resolves a cast memo wrapper over a cast forwardRef binding", () => {
    const src =
      "const Button = forwardRef((props, ref) => null) as Foo;\n" +
      "export default memo(Button) as Bar;\n";
    expect(detectDefinitionKind(parse(src), dflt)).toBe("function");
  });

  it("resolves a default export that references a local class", () => {
    const src = "class Button extends Component { render() {} }\nexport default Button;\n";
    expect(detectDefinitionKind(parse(src), dflt)).toBe("class");
  });

  it("classifies a default-exported HOC call as other", () => {
    expect(detectDefinitionKind(parse("export default connect()(Base);"), dflt)).toBe("other");
  });

  it("returns unanalyzed when there is no default export", () => {
    const src = "export const Button = () => null;";
    expect(detectDefinitionKind(parse(src), dflt)).toBe("unanalyzed");
  });
});

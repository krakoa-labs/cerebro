import { getProp, isIdentifier } from "./ast-guards.js";
import { type ExportLookup, resolveExportedValue } from "./export-resolution.js";
import type { ParsedSource } from "./parse-source.js";
import { type WrapperKind, wrapperKind } from "./react-wrappers.js";

export type PropsTyping = "typed" | "untyped" | "unanalyzed";

// Component-type references whose type argument carries the props contract.
// `React.FC` / `React.FunctionComponent` qualify too — only the final name
// segment is matched.
const FC_TYPE_NAMES = new Set(["FC", "FunctionComponent"]);

// TypeScript cast expressions: `x as T`, `<T>x`, `x satisfies T`. A `!`
// non-null assertion is a wrapper too but is handled apart — it names no
// target type, so it can never carry a props contract.
const TYPE_CAST_TYPES = new Set(["TSAsExpression", "TSTypeAssertion", "TSSatisfiesExpression"]);

type ComponentFunction =
  | { kind: "function"; fn: unknown }
  // A `forwardRef`/`memo` call whose own type arguments already type the props.
  | { kind: "typed-wrapper" }
  | { kind: "none" };

/**
 * Detects how the props of the Component the lookup points to are typed,
 * purely from the syntax of its source declaration — no TypeScript type
 * resolution. Returns `typed` when a type annotation governs the props (a
 * parameter annotation, an `FC`/`FunctionComponent` variable annotation, the
 * props type argument of a `forwardRef`/`memo` wrapper, or a cast to a named
 * type — `forwardRef(…) as ForwardRefComponent<…>`), `untyped` when a
 * function component with a props parameter carries no annotation at all, and
 * `unanalyzed` when no analyzable function-component declaration can be
 * identified (class components, deeply-wrapped HOCs, barrel-local
 * non-components, and shapes not yet supported).
 *
 * @param source - The parsed source file to inspect.
 * @param lookup - Which export to inspect: `default`, or a named export.
 * @returns The props-typing classification for the resolved Component.
 */
export function detectPropsTyping(source: ParsedSource, lookup: ExportLookup): PropsTyping {
  const body = getProp(source.program, "body");
  if (!Array.isArray(body)) return "unanalyzed";

  const exported = resolveExportedValue(body, lookup);
  if (exported === null) return "unanalyzed";

  return classifyValue(exported.value, exported.declaredType);
}

/**
 * Classifies a resolved export value into a props-typing verdict.
 *
 * @param value - The value bound by the export.
 * @param declaredType - The type annotation on the declared variable, if any.
 * @returns The props-typing classification.
 */
function classifyValue(value: unknown, declaredType: unknown): PropsTyping {
  if (declaredTypeIsFcForm(declaredType)) return "typed";

  const component = resolveComponentFunction(value);
  if (component.kind === "typed-wrapper") return "typed";
  if (component.kind === "none") return "unanalyzed";

  const params = getProp(component.fn, "params");
  if (!Array.isArray(params)) return "unanalyzed";
  if (params.length === 0) return "typed";
  if (paramIsTyped(params[0])) return "typed";

  // A props parameter exists with no annotation. An unrecognized variable
  // annotation may still type the props — reporting `untyped` would manufacture
  // false debt, so the honest verdict is `unanalyzed` (see ADR-0005).
  return declaredType === null || declaredType === undefined ? "untyped" : "unanalyzed";
}

/**
 * Resolves a value node to the function component it represents, unwrapping a
 * single `forwardRef`/`memo` layer and seeing through TypeScript expression
 * wrappers. A cast to a named type — `forwardRef(…) as ForwardRefComponent<…>`,
 * the polymorphic-ref typing workaround — is an explicit props contract and
 * short-circuits to `typed-wrapper` once the cast is confirmed to wrap a
 * component. A `!` assertion or a cast to a type that names no contract
 * (`as any`, `as () => JSX.Element`) carries no props information and is seen
 * through to the value beneath.
 *
 * @param value - The value node to resolve.
 * @returns The resolved component function, a typed-wrapper marker, or `none`.
 */
function resolveComponentFunction(value: unknown): ComponentFunction {
  const castInner = namedTypeCastExpression(value);
  if (castInner !== null) {
    // The cast names a type for the value; trust it as the props contract,
    // but only once the wrapped expression is itself a component — a cast
    // over a non-component value (`config as Settings`) types no props.
    return resolveComponentFunction(castInner).kind === "none"
      ? { kind: "none" }
      : { kind: "typed-wrapper" };
  }

  const type = getProp(value, "type");

  // Parentheses, a `!` assertion, and a cast whose target names no props
  // contract are all transparent: see through them to the value they wrap.
  if (
    type === "ParenthesizedExpression" ||
    type === "TSNonNullExpression" ||
    (typeof type === "string" && TYPE_CAST_TYPES.has(type))
  ) {
    return resolveComponentFunction(getProp(value, "expression"));
  }

  if (
    type === "FunctionDeclaration" ||
    type === "ArrowFunctionExpression" ||
    type === "FunctionExpression"
  ) {
    return { kind: "function", fn: value };
  }

  if (type === "CallExpression") return resolveWrappedComponent(value);

  return { kind: "none" };
}

/**
 * When `node` is a TypeScript cast to a named type reference (`x as Foo`,
 * `x as Foo<Bar>`, `<Foo>x`, `x satisfies Foo`), returns the expression the
 * cast wraps — the cast is an explicit type annotation on that expression.
 * Returns `null` for any other node, and for casts whose target is not a
 * named type: `as any`, `as () => void`, `as { … }` name no props contract.
 *
 * @param node - The value node to inspect.
 * @returns The wrapped expression, or `null` when `node` is not such a cast.
 */
function namedTypeCastExpression(node: unknown): unknown {
  const type = getProp(node, "type");
  if (typeof type !== "string" || !TYPE_CAST_TYPES.has(type)) return null;
  if (getProp(getProp(node, "typeAnnotation"), "type") !== "TSTypeReference") return null;
  return getProp(node, "expression") ?? null;
}

/**
 * Resolves the component carried by a `forwardRef(…)` / `memo(…)` call. When
 * the wrapper's type arguments already type the props, the props are typed
 * regardless of the inner function; otherwise the inner function is unwrapped.
 *
 * @param call - The `CallExpression` node.
 * @returns The resolved component function, a typed-wrapper marker, or `none`.
 */
function resolveWrappedComponent(call: unknown): ComponentFunction {
  const wrapper = wrapperKind(getProp(call, "callee"));
  if (wrapper === null) return { kind: "none" };

  if (wrapperTypeArgsCoverProps(wrapper, getProp(call, "typeArguments"))) {
    return { kind: "typed-wrapper" };
  }

  const args = getProp(call, "arguments");
  return resolveComponentFunction(Array.isArray(args) ? args[0] : undefined);
}

/**
 * Tests whether a wrapper call's type arguments include the props type.
 * `forwardRef<Ref, Props>` types the props with its second argument;
 * `memo<Props>` with its first.
 *
 * @param wrapper - The wrapper kind.
 * @param typeArguments - The call's `typeArguments` node.
 * @returns `true` when the type arguments cover the props.
 */
function wrapperTypeArgsCoverProps(wrapper: WrapperKind, typeArguments: unknown): boolean {
  const params = getProp(typeArguments, "params");
  if (!Array.isArray(params)) return false;
  return wrapper === "forwardRef" ? params.length >= 2 : params.length >= 1;
}

/**
 * Tests whether a function parameter node carries a type annotation. Covers a
 * plain identifier, a destructured object pattern, and a defaulted parameter
 * (`props: P = {}`) whose annotation sits on the assignment's left-hand side.
 *
 * @param param - The first-parameter AST node.
 * @returns `true` when the parameter is annotated.
 */
function paramIsTyped(param: unknown): boolean {
  const target = getProp(param, "type") === "AssignmentPattern" ? getProp(param, "left") : param;
  const annotation = getProp(target, "typeAnnotation");
  return annotation !== null && annotation !== undefined;
}

/**
 * Tests whether a variable's declared type annotation is an `FC` /
 * `FunctionComponent` reference (qualified or not) — the form that carries the
 * props contract on the variable rather than on the function parameter.
 *
 * @param declaredType - The `TSTypeAnnotation` node on the declared variable.
 * @returns `true` when the annotation is a recognized function-component type.
 */
function declaredTypeIsFcForm(declaredType: unknown): boolean {
  const tsType = getProp(declaredType, "typeAnnotation");
  if (getProp(tsType, "type") !== "TSTypeReference") return false;

  const typeName = getProp(tsType, "typeName");
  if (isIdentifier(typeName)) return FC_TYPE_NAMES.has(typeName.name);

  if (getProp(typeName, "type") === "TSQualifiedName") {
    const right = getProp(typeName, "right");
    return isIdentifier(right) && FC_TYPE_NAMES.has(right.name);
  }

  return false;
}

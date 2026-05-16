import { getProp, isIdentifier, isMemberExpression } from "./ast-guards.js";
import type { ParsedSource } from "./parse-source.js";

export type PropsTyping = "typed" | "untyped" | "unanalyzed";

export type PropsLookup = { kind: "default" } | { kind: "named"; name: string };

// Component-type references whose type argument carries the props contract.
// `React.FC` / `React.FunctionComponent` qualify too — only the final name
// segment is matched.
const FC_TYPE_NAMES = new Set(["FC", "FunctionComponent"]);

interface ExportedValue {
  // The value bound by the export: a function, class, call expression, literal…
  value: unknown;
  // Type annotation on the declared variable (`const Foo: T = …`), or `null`.
  declaredType: unknown;
}

type ComponentFunction =
  | { kind: "function"; fn: unknown }
  // A `forwardRef`/`memo` call whose own type arguments already type the props.
  | { kind: "typed-wrapper" }
  | { kind: "none" };

/**
 * Detects how the props of the Component the lookup points to are typed,
 * purely from the syntax of its source declaration — no TypeScript type
 * resolution. Returns `typed` when a type annotation governs the props (a
 * parameter annotation, an `FC`/`FunctionComponent` variable annotation, or
 * the props type argument of a `forwardRef`/`memo` wrapper), `untyped` when a
 * function component with a props parameter carries no annotation at all, and
 * `unanalyzed` when no analyzable function-component declaration can be
 * identified (class components, deeply-wrapped HOCs, barrel-local
 * non-components, and shapes not yet supported).
 *
 * @param source - The parsed source file to inspect.
 * @param lookup - Which export to inspect: `default`, or a named export.
 * @returns The props-typing classification for the resolved Component.
 */
export function detectPropsTyping(source: ParsedSource, lookup: PropsLookup): PropsTyping {
  const body = getProp(source.program, "body");
  if (!Array.isArray(body)) return "unanalyzed";

  const exported = resolveExportedValue(body, lookup);
  if (exported === null) return "unanalyzed";

  return classifyValue(exported.value, exported.declaredType);
}

/**
 * Resolves the export the lookup points to down to the value it binds.
 *
 * @param body - Top-level body statements of the source program.
 * @param lookup - Which export to resolve.
 * @returns The bound value and its declared type annotation, or `null` when
 *   the export cannot be traced to a value in this file.
 */
function resolveExportedValue(body: unknown[], lookup: PropsLookup): ExportedValue | null {
  if (lookup.kind === "default") return resolveDefaultExport(body);
  return resolveNamedBinding(body, lookup.name);
}

/**
 * Resolves a named binding by scanning every top-level statement — both
 * inline-exported declarations (`export const Foo`, `export function Foo`) and
 * standalone declarations later published via `export { Foo }`.
 *
 * @param body - Top-level body statements of the source program.
 * @param name - The local binding name to find.
 * @returns The bound value, or `null` when no declaration matches.
 */
function resolveNamedBinding(body: unknown[], name: string): ExportedValue | null {
  for (const stmt of body) {
    const declaration =
      getProp(stmt, "type") === "ExportNamedDeclaration" ? getProp(stmt, "declaration") : stmt;

    const found = bindingFromDeclaration(declaration, name);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Extracts the value bound to `name` from a single declaration node, when that
 * declaration binds it. Handles function/class declarations and variable
 * declarations (whose declarator may carry the declared type annotation).
 *
 * @param declaration - The candidate declaration node.
 * @param name - The binding name to match.
 * @returns The bound value, or `null` when the declaration does not bind it.
 */
function bindingFromDeclaration(declaration: unknown, name: string): ExportedValue | null {
  const type = getProp(declaration, "type");

  if (type === "FunctionDeclaration" || type === "ClassDeclaration") {
    const id = getProp(declaration, "id");
    if (isIdentifier(id) && id.name === name) return { value: declaration, declaredType: null };
    return null;
  }

  if (type === "VariableDeclaration") {
    const declarations = getProp(declaration, "declarations");
    if (!Array.isArray(declarations)) return null;

    for (const declarator of declarations) {
      const id = getProp(declarator, "id");
      if (isIdentifier(id) && id.name === name) {
        return {
          value: getProp(declarator, "init"),
          declaredType: getProp(id, "typeAnnotation") ?? null,
        };
      }
    }
  }

  return null;
}

/**
 * Resolves the `export default …` of a file. A default that exports a
 * function/class declaration or an inline function/call expression resolves
 * to that node; a default that exports a bare identifier resolves through the
 * local binding of that name.
 *
 * @param body - Top-level body statements of the source program.
 * @returns The default-exported value, or `null` when there is no default
 *   export or it cannot be traced to a value.
 */
function resolveDefaultExport(body: unknown[]): ExportedValue | null {
  const exportDefault = body.find((stmt) => getProp(stmt, "type") === "ExportDefaultDeclaration");
  if (exportDefault === undefined) return null;

  const declaration = getProp(exportDefault, "declaration");
  if (getProp(declaration, "type") === "Identifier") {
    const refName = getProp(declaration, "name");
    if (typeof refName !== "string") return null;
    return resolveNamedBinding(body, refName);
  }

  return { value: declaration, declaredType: null };
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
 * single `forwardRef`/`memo` layer. A wrapper whose own type arguments cover
 * the props short-circuits to `typed-wrapper`.
 *
 * @param value - The value node to resolve.
 * @returns The resolved component function, a typed-wrapper marker, or `none`.
 */
function resolveComponentFunction(value: unknown): ComponentFunction {
  const type = getProp(value, "type");

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
 * Identifies a `forwardRef` / `memo` callee, whether called bare or qualified
 * (`React.forwardRef`). Only the final name segment is matched.
 *
 * @param callee - The `CallExpression.callee` node.
 * @returns The wrapper kind, or `null` for any other callee.
 */
function wrapperKind(callee: unknown): "forwardRef" | "memo" | null {
  let name: string | null = null;
  if (isIdentifier(callee)) name = callee.name;
  else if (isMemberExpression(callee) && isIdentifier(callee.property)) name = callee.property.name;

  if (name === "forwardRef") return "forwardRef";
  if (name === "memo") return "memo";
  return null;
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
function wrapperTypeArgsCoverProps(
  wrapper: "forwardRef" | "memo",
  typeArguments: unknown,
): boolean {
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

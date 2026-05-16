import { getProp, isIdentifier, isMemberExpression } from "./ast-guards.js";
import type { ParsedSource } from "./parse-source.js";

export type DefinitionKind = "class" | "function" | "other" | "unanalyzed";

export type DefinitionKindLookup = { kind: "default" } | { kind: "named"; name: string };

// React base classes a class component extends. Only the final name segment is
// matched, so a bare `Component` and a qualified `React.Component` both count.
const REACT_BASE_CLASSES = new Set(["Component", "PureComponent"]);

// TypeScript expression wrappers that annotate a value without changing it at
// runtime (`x as T`, `x satisfies T`, `x!`, `<T>x`). They are seen through when
// classifying, so a cast like `forwardRef(...) as Foo` — common around the
// polymorphic-ref typing workaround — is not mistaken for `other`.
const TYPE_WRAPPER_TYPES = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);

/**
 * Detects whether the Component the lookup points to is written as a class
 * component or a function component, purely from the syntax of its source
 * declaration — no TypeScript type resolution. Returns `class` when the
 * resolved value is a class extending a React base class, `function` for any
 * function/arrow form (including a `forwardRef`/`memo` wrapper around one),
 * `other` when the value resolves but is neither (styled-components, HOC
 * results, a class with no recognized base, non-component exports), and
 * `unanalyzed` when the export cannot be traced to a value in this file.
 *
 * @param source - The parsed source file to inspect.
 * @param lookup - Which export to inspect: `default`, or a named export.
 * @returns The definition-kind classification for the resolved Component.
 */
export function detectDefinitionKind(
  source: ParsedSource,
  lookup: DefinitionKindLookup,
): DefinitionKind {
  const body = getProp(source.program, "body");
  if (!Array.isArray(body)) return "unanalyzed";

  const resolved = resolveExportedValue(body, lookup);
  if (resolved.kind === "untraceable") return "unanalyzed";

  return classifyValue(resolved.value, body, new Set());
}

// A resolution either traces the export to a bound value node, or fails to
// find any declaration for it in this file (`untraceable`).
type Resolution = { kind: "value"; value: unknown } | { kind: "untraceable" };

const UNTRACEABLE: Resolution = { kind: "untraceable" };

/**
 * Resolves the export the lookup points to down to the value it binds.
 *
 * @param body - Top-level body statements of the source program.
 * @param lookup - Which export to resolve.
 * @returns The bound value, or `untraceable` when the export cannot be traced
 *   to a declaration in this file.
 */
function resolveExportedValue(body: unknown[], lookup: DefinitionKindLookup): Resolution {
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
 * @returns The bound value, or `untraceable` when no declaration matches.
 */
function resolveNamedBinding(body: unknown[], name: string): Resolution {
  for (const stmt of body) {
    const declaration =
      getProp(stmt, "type") === "ExportNamedDeclaration" ? getProp(stmt, "declaration") : stmt;

    const found = bindingFromDeclaration(declaration, name);
    if (found.kind === "value") return found;
  }
  return UNTRACEABLE;
}

/**
 * Extracts the value bound to `name` from a single declaration node, when that
 * declaration binds it. Handles function/class declarations and variable
 * declarations.
 *
 * @param declaration - The candidate declaration node.
 * @param name - The binding name to match.
 * @returns The bound value, or `untraceable` when the declaration does not
 *   bind `name`.
 */
function bindingFromDeclaration(declaration: unknown, name: string): Resolution {
  const type = getProp(declaration, "type");

  if (type === "FunctionDeclaration" || type === "ClassDeclaration") {
    const id = getProp(declaration, "id");
    if (isIdentifier(id) && id.name === name) return { kind: "value", value: declaration };
    return UNTRACEABLE;
  }

  if (type === "VariableDeclaration") {
    const declarations = getProp(declaration, "declarations");
    if (!Array.isArray(declarations)) return UNTRACEABLE;

    for (const declarator of declarations) {
      const id = getProp(declarator, "id");
      if (isIdentifier(id) && id.name === name) {
        return { kind: "value", value: getProp(declarator, "init") };
      }
    }
  }

  return UNTRACEABLE;
}

/**
 * Resolves the `export default …` of a file. A default that exports a
 * function/class declaration or an inline expression resolves to that node; a
 * default that exports a bare identifier resolves through the local binding of
 * that name.
 *
 * @param body - Top-level body statements of the source program.
 * @returns The default-exported value, or `untraceable` when there is no
 *   default export or it cannot be traced to a declaration in this file.
 */
function resolveDefaultExport(body: unknown[]): Resolution {
  const exportDefault = body.find((stmt) => getProp(stmt, "type") === "ExportDefaultDeclaration");
  if (exportDefault === undefined) return UNTRACEABLE;

  const declaration = skipTypeWrappers(getProp(exportDefault, "declaration"));
  if (getProp(declaration, "type") === "Identifier") {
    const refName = getProp(declaration, "name");
    if (typeof refName !== "string") return UNTRACEABLE;
    return resolveNamedBinding(body, refName);
  }

  return { kind: "value", value: declaration };
}

/**
 * Classifies a resolved value node into a definition-kind verdict. A
 * `forwardRef`/`memo` call is unwrapped to the component it carries.
 *
 * @param value - The value node to classify.
 * @param body - Top-level body statements, used to re-resolve an identifier
 *   passed to a `forwardRef`/`memo` wrapper.
 * @param visited - Binding names already followed, guarding against a cyclic
 *   reference (`const Foo = memo(Foo)`).
 * @returns The definition-kind classification.
 */
function classifyValue(value: unknown, body: unknown[], visited: Set<string>): DefinitionKind {
  const unwrapped = skipTypeWrappers(value);
  const type = getProp(unwrapped, "type");

  if (type === "ClassDeclaration" || type === "ClassExpression") {
    return extendsReactBase(unwrapped) ? "class" : "other";
  }

  if (
    type === "FunctionDeclaration" ||
    type === "ArrowFunctionExpression" ||
    type === "FunctionExpression"
  ) {
    return "function";
  }

  if (type === "CallExpression") return classifyWrapperCall(unwrapped, body, visited);

  return "other";
}

/**
 * Peels TypeScript type-only expression wrappers (`as`, `satisfies`, `!`,
 * `<T>`) off a value node, exposing the runtime value they annotate.
 *
 * @param node - The value node, possibly wrapped in type expressions.
 * @returns The innermost wrapped node.
 */
function skipTypeWrappers(node: unknown): unknown {
  let current = node;
  let type = getProp(current, "type");
  while (typeof type === "string" && TYPE_WRAPPER_TYPES.has(type)) {
    current = getProp(current, "expression");
    type = getProp(current, "type");
  }
  return current;
}

/**
 * Classifies the value carried by a call expression. Only `forwardRef`/`memo`
 * wrappers are unwrapped; any other call (an HOC result, a factory) is `other`.
 *
 * @param call - The `CallExpression` node.
 * @param body - Top-level body statements, forwarded for identifier
 *   re-resolution.
 * @param visited - Binding names already followed.
 * @returns The definition-kind classification of the wrapped value.
 */
function classifyWrapperCall(call: unknown, body: unknown[], visited: Set<string>): DefinitionKind {
  if (wrapperKind(getProp(call, "callee")) === null) return "other";

  const args = getProp(call, "arguments");
  const inner = Array.isArray(args) ? args[0] : undefined;

  // A wrapper applied to a local identifier (`memo(ButtonBase)`) is followed to
  // that binding; an inline function/class argument is classified directly.
  if (isIdentifier(inner)) {
    if (visited.has(inner.name)) return "other";
    visited.add(inner.name);
    const resolved = resolveNamedBinding(body, inner.name);
    if (resolved.kind === "untraceable") return "other";
    return classifyValue(resolved.value, body, visited);
  }

  return classifyValue(inner, body, visited);
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
 * Tests whether a class node extends a React base class — `Component` or
 * `PureComponent`, either bare or as the property of a member expression
 * (`React.Component`). Matching is by name only; the import origin of the base
 * is not verified.
 *
 * @param classNode - The `ClassDeclaration` / `ClassExpression` node.
 * @returns `true` when the class extends a recognized React base class.
 */
function extendsReactBase(classNode: unknown): boolean {
  const superClass = getProp(classNode, "superClass");
  if (superClass === null || superClass === undefined) return false;

  if (isIdentifier(superClass)) return REACT_BASE_CLASSES.has(superClass.name);

  if (isMemberExpression(superClass) && isIdentifier(superClass.property)) {
    return REACT_BASE_CLASSES.has(superClass.property.name);
  }

  return false;
}

import { getProp, isIdentifier } from "./ast-guards.js";
import {
  type ExportLookup,
  resolveExportedValue,
  resolveNamedBinding,
} from "./export-resolution.js";
import type { ParsedSource } from "./parse-source.js";
import { type WrapperKind, wrapperKind } from "./react-wrappers.js";

// Type names whose appearance as the `children` annotation means children
// arrive as React elements — a fresh reference on every parent render, the
// shape that defeats `memo`. Unqualified, only `ReactNode`/`ReactElement`
// count; bare `Element` is the DOM type, not a React node. Qualified, the set
// also admits `Element` so that `JSX.Element` (and `React.ReactNode` etc.)
// resolve through their final segment.
const ELEMENT_TYPE_NAMES = new Set(["ReactNode", "ReactElement"]);
const QUALIFIED_ELEMENT_TYPE_NAMES = new Set(["ReactNode", "ReactElement", "Element"]);

// Component-type references whose first type argument carries the props
// contract: `FC<P>` / `FunctionComponent<P>` (qualified `React.FC` too).
const FC_TYPE_NAMES = new Set(["FC", "FunctionComponent"]);

// Expression wrappers carrying no meaning for this detection — parentheses, a
// `!` assertion, and TypeScript casts (`memo(C) as MemoComponent<…>`) — all
// seen through to the value they wrap via its `expression` field.
const TRANSPARENT_WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSNonNullExpression",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSSatisfiesExpression",
]);

/**
 * Detects the Memo-with-children footgun on the Component the lookup points to:
 * the Component is wrapped in `memo()` with no custom comparator and its props
 * declare a `children` member typed to admit React elements. In that shape the
 * memoization is inert — element children are a fresh reference on every parent
 * render, so `memo`'s shallow props comparison always fails and no render is
 * skipped.
 *
 * The `memo()` may wrap the Component inline (`export const X = memo(C)`) or be
 * applied to a named binding at its export (`const C = …; export default
 * memo(C)`) — the dominant shape, where Cerebro resolves the Component to the
 * inner declaration `C` and the `memo` sits on the publication. Both count.
 *
 * Returns `false` for every other shape, including a memo with a custom
 * comparator and children typed as a bare `string`/`number`, where the memo can
 * legitimately work (see ADR-0013), and as the quiet default when the
 * declaration cannot be analyzed (see ADR-0005).
 *
 * @param source - The parsed source file to inspect.
 * @param lookup - Which export to inspect: `default`, or a named export.
 * @returns `true` when the Component exhibits the Memo-with-children footgun.
 */
export function detectMemoWithChildren(source: ParsedSource, lookup: ExportLookup): boolean {
  const body = getProp(source.program, "body");
  if (!Array.isArray(body)) return false;

  const exported = resolveExportedValue(body, lookup);
  if (exported === null) return false;

  if (!isMemoized(exported.value, lookup, body)) return false;

  const propsType = propsTypeOfComponent(exported.value, body, new Set());
  return propsType !== null && declaresElementChildren(propsType, body);
}

/**
 * Sees through the expression wrappers that carry no meaning here —
 * parentheses and a `!` non-null assertion — to the value beneath.
 *
 * @param value - The value node to unwrap.
 * @returns The wrapped value, or `value` itself when it is not wrapped.
 */
function unwrapTransparent(value: unknown): unknown {
  const type = getProp(value, "type");
  if (typeof type === "string" && TRANSPARENT_WRAPPERS.has(type)) {
    return unwrapTransparent(getProp(value, "expression"));
  }
  return value;
}

/**
 * Tests whether a value is a `memo(…)` / `React.memo(…)` call with no custom
 * comparator — a single-argument call. A second argument is an explicit
 * `arePropsEqual` opt-in that may handle children deliberately, so it is not
 * the footgun (see ADR-0013).
 *
 * @param value - The already-unwrapped value node.
 * @returns `true` when the value is a comparator-free memo call.
 */
function isUncomparedMemoCall(value: unknown): boolean {
  if (getProp(value, "type") !== "CallExpression") return false;
  if (wrapperKind(getProp(value, "callee")) !== "memo") return false;

  const args = getProp(value, "arguments");
  return Array.isArray(args) && args.length < 2;
}

/**
 * Tests whether the Component is memoized without a custom comparator — either
 * its value is a `memo(…)` call directly (`export const X = memo(C)`), or its
 * named binding is wrapped by `memo(binding)` at an export elsewhere in the
 * file (`const C = …; export default memo(C)`). The latter is the dominant
 * publication shape: Cerebro resolves the Component to the inner declaration,
 * so the `memo` on the export is found by the binding name rather than on the
 * resolved value.
 *
 * @param value - The value the lookup resolved to.
 * @param lookup - The export the Component was looked up by.
 * @param body - Top-level statements of the source file.
 * @returns `true` when the Component is memoized without a comparator.
 */
function isMemoized(value: unknown, lookup: ExportLookup, body: unknown[]): boolean {
  if (isUncomparedMemoCall(unwrapTransparent(value))) return true;

  return lookup.kind === "named" && bindingIsMemoizedAtExport(body, lookup.name);
}

/**
 * Tests whether a named binding is wrapped by `memo(binding)` — with no custom
 * comparator — at any top-level export of the file, the shape produced by
 * `const C = …; export default memo(C)` (or `export const M = memo(C)`).
 *
 * @param body - Top-level statements to scan.
 * @param name - The binding name the memo must wrap.
 * @returns `true` when an export memoizes the binding.
 */
function bindingIsMemoizedAtExport(body: unknown[], name: string): boolean {
  return body.some((stmt) => statementMemoizesIdentifier(stmt, name));
}

/**
 * Tests whether a single top-level statement publishes `memo(name)` — a default
 * export of the call, or a variable declarator initialized to it.
 *
 * @param stmt - The top-level statement to inspect.
 * @param name - The binding name the memo must wrap.
 * @returns `true` when the statement memoizes the binding.
 */
function statementMemoizesIdentifier(stmt: unknown, name: string): boolean {
  const type = getProp(stmt, "type");

  if (type === "ExportDefaultDeclaration") {
    return memoCallWrapsIdentifier(getProp(stmt, "declaration"), name);
  }

  const declaration = type === "ExportNamedDeclaration" ? getProp(stmt, "declaration") : stmt;
  if (getProp(declaration, "type") !== "VariableDeclaration") return false;

  const declarators = getProp(declaration, "declarations");
  return (
    Array.isArray(declarators) &&
    declarators.some((declarator) => memoCallWrapsIdentifier(getProp(declarator, "init"), name))
  );
}

/**
 * Tests whether an expression is `memo(name)` — a comparator-free memo call
 * whose single argument is the identifier `name`.
 *
 * @param expr - The expression to inspect.
 * @param name - The identifier the memo must wrap.
 * @returns `true` when `expr` memoizes the named identifier.
 */
function memoCallWrapsIdentifier(expr: unknown, name: string): boolean {
  const call = unwrapTransparent(expr);
  if (!isUncomparedMemoCall(call)) return false;

  const args = getProp(call, "arguments");
  const arg = Array.isArray(args) ? unwrapTransparent(args[0]) : null;
  return isIdentifier(arg) && arg.name === name;
}

/**
 * Resolves the props type node governing a memo-wrapped Component. Reads it from
 * an `FC<P>` variable annotation, a wrapper's type argument (`memo<P>`,
 * `forwardRef<R, P>`), or the inner function's first parameter annotation, and
 * follows a same-file identifier to its declaration — the common
 * `export default memo(Component)` shape, where `memo` wraps a named component
 * declared above. Returns `null` when no props type is stated in this file — an
 * untyped parameter, a props type imported from elsewhere, or a component
 * resolved from another module — which leaves the footgun unflagged (the quiet
 * direction). `seen` guards against a self-referential binding cycle.
 *
 * @param value - The memo call node, or a node nested within its wrappers.
 * @param body - Top-level statements, used to resolve an identifier reference.
 * @param seen - Identifier names already resolved on this path.
 * @returns The props type AST node, or `null` when none is found here.
 */
function propsTypeOfComponent(value: unknown, body: unknown[], seen: Set<string>): unknown {
  const node = unwrapTransparent(value);
  const type = getProp(node, "type");

  if (type === "Identifier") {
    const name = getProp(node, "name");
    if (typeof name !== "string" || seen.has(name)) return null;
    seen.add(name);

    const binding = resolveNamedBinding(body, name);
    if (binding === null) return null;

    return fcPropsType(binding.declaredType) ?? propsTypeOfComponent(binding.value, body, seen);
  }

  if (type === "CallExpression") {
    const wrapper = wrapperKind(getProp(node, "callee"));
    if (wrapper === null) return null;

    const typeArg = wrapperPropsTypeArgument(wrapper, getProp(node, "typeArguments"));
    if (typeArg !== null) return typeArg;

    const args = getProp(node, "arguments");
    return propsTypeOfComponent(Array.isArray(args) ? args[0] : null, body, seen);
  }

  if (
    type === "ArrowFunctionExpression" ||
    type === "FunctionExpression" ||
    type === "FunctionDeclaration"
  ) {
    return firstParameterType(node);
  }

  return null;
}

/**
 * Reads the props type argument from an `FC<P>` / `FunctionComponent<P>`
 * variable type annotation (qualified `React.FC<P>` too) — the form that
 * carries the props contract on the declared variable rather than on the
 * function parameter. Returns `null` for any other annotation.
 *
 * @param declaredType - The `TSTypeAnnotation` on the declared variable.
 * @returns The props type node, or `null`.
 */
function fcPropsType(declaredType: unknown): unknown {
  const tsType = getProp(declaredType, "typeAnnotation");
  if (getProp(tsType, "type") !== "TSTypeReference") return null;

  const finalName = typeReferenceFinalName(getProp(tsType, "typeName"));
  if (finalName === null || !FC_TYPE_NAMES.has(finalName)) return null;

  const params = getProp(getProp(tsType, "typeArguments"), "params");
  return Array.isArray(params) ? (params[0] ?? null) : null;
}

/**
 * Returns the final identifier name of a type reference's name node — the bare
 * identifier, or the right segment of a qualified name (`React.FC` → `FC`).
 *
 * @param typeName - The `typeName` node of a `TSTypeReference`.
 * @returns The final name, or `null`.
 */
function typeReferenceFinalName(typeName: unknown): string | null {
  if (isIdentifier(typeName)) return typeName.name;

  if (getProp(typeName, "type") === "TSQualifiedName") {
    const right = getProp(typeName, "right");
    return isIdentifier(right) ? right.name : null;
  }

  return null;
}

/**
 * Reads the props type argument from a wrapper call's type arguments: `memo<P>`
 * types the props with its first argument, `forwardRef<R, P>` with its second.
 *
 * @param wrapper - The wrapper kind.
 * @param typeArguments - The call's `typeArguments` node.
 * @returns The props type node, or `null` when the wrapper carries none.
 */
function wrapperPropsTypeArgument(wrapper: WrapperKind, typeArguments: unknown): unknown {
  const params = getProp(typeArguments, "params");
  if (!Array.isArray(params)) return null;

  const index = wrapper === "forwardRef" ? 1 : 0;
  return params[index] ?? null;
}

/**
 * Reads the type node annotating a function's first parameter — the props
 * parameter — for a plain identifier or a destructured object pattern.
 *
 * @param fn - The function node.
 * @returns The props type node, or `null` when the first parameter is missing
 *   or carries no annotation.
 */
function firstParameterType(fn: unknown): unknown {
  const params = getProp(fn, "params");
  if (!Array.isArray(params) || params.length === 0) return null;

  const annotation = getProp(params[0], "typeAnnotation");
  return getProp(annotation, "typeAnnotation") ?? null;
}

/**
 * Tests whether a props type declares a `children` member typed to admit React
 * elements. Resolves the props type to its member list — an inline object type,
 * or a `TSTypeReference` to an `interface`/`type` declared in the same file —
 * then inspects the `children` member's annotation. A props type imported from
 * another file, or built from `extends`/intersection/union, yields no readable
 * members and does not flag (the quiet direction).
 *
 * @param propsType - The props type AST node.
 * @param body - Top-level statements, used to resolve a named props type.
 * @returns `true` when an element-typed `children` member is present.
 */
function declaresElementChildren(propsType: unknown, body: unknown[]): boolean {
  const members = propsTypeMembers(propsType, body);
  if (members === null) return false;

  const children = members.find(
    (member) =>
      getProp(member, "type") === "TSPropertySignature" && isChildrenKey(getProp(member, "key")),
  );
  if (children === undefined) return false;

  const annotation = getProp(children, "typeAnnotation");
  return isElementType(getProp(annotation, "typeAnnotation"));
}

/**
 * Resolves a props type node to its member signatures: directly for an inline
 * object type, or by finding the same-file `interface`/`type` of that name.
 *
 * @param propsType - The props type node.
 * @param body - Top-level statements to resolve a named reference against.
 * @returns The member nodes, or `null` when they cannot be resolved here.
 */
function propsTypeMembers(propsType: unknown, body: unknown[]): unknown[] | null {
  const literalMembers = objectTypeMembers(propsType);
  if (literalMembers !== null) return literalMembers;

  const typeName = getProp(propsType, "typeName");
  if (getProp(propsType, "type") === "TSTypeReference" && isIdentifier(typeName)) {
    return namedTypeMembers(typeName.name, body);
  }

  return null;
}

/**
 * Returns the member signatures of an inline object type (`TSTypeLiteral`), or
 * `null` for any other node.
 *
 * @param node - The candidate type node.
 * @returns The member nodes, or `null`.
 */
function objectTypeMembers(node: unknown): unknown[] | null {
  if (getProp(node, "type") !== "TSTypeLiteral") return null;

  const members = getProp(node, "members");
  return Array.isArray(members) ? members : null;
}

/**
 * Finds the members of an `interface` or object-type `type` alias of the given
 * name among a file's top-level statements, whether exported inline or
 * declared standalone. Returns `null` when no such declaration is found, or the
 * alias does not name an inline object type.
 *
 * @param name - The type name to resolve.
 * @param body - Top-level statements to scan.
 * @returns The member nodes, or `null`.
 */
function namedTypeMembers(name: string, body: unknown[]): unknown[] | null {
  for (const stmt of body) {
    const declaration =
      getProp(stmt, "type") === "ExportNamedDeclaration" ? getProp(stmt, "declaration") : stmt;
    const type = getProp(declaration, "type");

    if (type === "TSInterfaceDeclaration" && identifierNamed(getProp(declaration, "id"), name)) {
      const members = getProp(getProp(declaration, "body"), "body");
      return Array.isArray(members) ? members : null;
    }

    if (type === "TSTypeAliasDeclaration" && identifierNamed(getProp(declaration, "id"), name)) {
      return objectTypeMembers(getProp(declaration, "typeAnnotation"));
    }
  }

  return null;
}

/**
 * Tests whether a property key is the identifier `children`.
 *
 * @param key - The `TSPropertySignature` key node.
 * @returns `true` when the key is the identifier `children`.
 */
function isChildrenKey(key: unknown): boolean {
  return isIdentifier(key) && key.name === "children";
}

/**
 * Tests whether a `children` type annotation admits React elements:
 * `ReactNode`/`ReactElement` (bare, qualified as `React.ReactNode`, or
 * `JSX.Element`), or an array of such. A bare `string`/`number`, a DOM
 * `Element`, and every other shape are not element children.
 *
 * @param node - The type node annotating the `children` member.
 * @returns `true` when the annotation admits React elements.
 */
function isElementType(node: unknown): boolean {
  const type = getProp(node, "type");

  if (type === "TSArrayType") return isElementType(getProp(node, "elementType"));

  if (type === "TSTypeReference") {
    const typeName = getProp(node, "typeName");
    if (isIdentifier(typeName)) return ELEMENT_TYPE_NAMES.has(typeName.name);

    if (getProp(typeName, "type") === "TSQualifiedName") {
      const right = getProp(typeName, "right");
      return isIdentifier(right) && QUALIFIED_ELEMENT_TYPE_NAMES.has(right.name);
    }
  }

  return false;
}

/**
 * Tests whether a node is an identifier with the given name.
 *
 * @param node - The candidate identifier node.
 * @param name - The name to match.
 * @returns `true` when `node` is an identifier named `name`.
 */
function identifierNamed(node: unknown, name: string): boolean {
  return isIdentifier(node) && node.name === name;
}

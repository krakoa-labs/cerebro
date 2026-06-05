import { getProp, isIdentifier, isObject } from "./ast-guards.js";
import {
  type ExportLookup,
  resolveExportedValue,
  resolveNamedBinding,
} from "./export-resolution.js";
import type { ParsedSource } from "./parse-source.js";
import { wrapperKind } from "./react-wrappers.js";

// Expression wrappers carrying no meaning here — parentheses, a `!` assertion,
// and TypeScript casts — seen through to the value they wrap.
const TRANSPARENT_WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSNonNullExpression",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSSatisfiesExpression",
]);

// Function-literal node types — the forms a component can be written in.
const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

/**
 * Detects the nested-component-definition footgun on the Component the lookup
 * points to: the Component's render body defines another component inline. A
 * component defined inside another's render is created afresh on every parent
 * render — a new component type each time — so React unmounts and remounts its
 * whole subtree, discarding that subtree's DOM nodes, focus, and state.
 *
 * A nested component is a PascalCase-named declaration — a `function`
 * declaration, or a `const` bound to an arrow/function expression (seen through
 * a `memo`/`forwardRef` wrapper) — whose function returns JSX. The render body
 * is walked recursively, so a component hidden inside a conditional, a `.map()`
 * callback, or an effect counts the same as one declared at the top.
 *
 * Returns `false` for every other shape, and as the quiet default when the
 * Component cannot be resolved to a function in this file — a class component,
 * a component imported from another module, or an unparseable source (see
 * ADR-0005). Styled-components and other non-function component factories are
 * not recognized: they never appear as a function-returning-JSX, so they fall
 * to the quiet default rather than being flagged (see ADR-0015).
 *
 * @param source - The parsed source file to inspect.
 * @param lookup - Which export to inspect: `default`, or a named export.
 * @returns `true` when the Component defines a component inside its render body.
 */
export function detectNestedComponentDefinition(
  source: ParsedSource,
  lookup: ExportLookup,
): boolean {
  const body = getProp(source.program, "body");
  if (!Array.isArray(body)) return false;

  const resolved = resolveExportedValue(body, lookup, unwrapTransparent);
  if (resolved === null) return false;

  const fn = resolveToFunction(resolved.value, body, new Set());
  if (fn === null) return false;

  return bodyDefinesComponent(getProp(fn, "body"));
}

/**
 * Sees through the expression wrappers that carry no meaning here —
 * parentheses, a `!` non-null assertion, and TypeScript casts — to the value
 * beneath.
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
 * Resolves a Component's value to its inner function node, seeing through
 * transparent wrappers, `memo`/`forwardRef` calls, and a same-file binding
 * reference (`const C = …; export default memo(C)`). Returns `null` when the
 * value is not a function in this file — a class declaration, a non-wrapper
 * call, or a reference that does not resolve — leaving the footgun unflagged.
 * `seen` guards against a self-referential binding cycle.
 *
 * @param value - The value node to resolve.
 * @param body - Top-level statements, used to resolve an identifier reference.
 * @param seen - Identifier names already followed on this path.
 * @returns The inner function node, or `null` when none is found here.
 */
function resolveToFunction(value: unknown, body: unknown[], seen: Set<string>): unknown {
  const node = unwrapTransparent(value);
  const type = getProp(node, "type");

  if (typeof type === "string" && FUNCTION_TYPES.has(type)) return node;

  if (type === "Identifier") {
    const name = getProp(node, "name");
    if (typeof name !== "string" || seen.has(name)) return null;
    seen.add(name);

    const binding = resolveNamedBinding(body, name);
    return binding === null ? null : resolveToFunction(binding.value, body, seen);
  }

  if (type === "CallExpression") {
    if (wrapperKind(getProp(node, "callee")) === null) return null;

    const args = getProp(node, "arguments");
    return resolveToFunction(Array.isArray(args) ? args[0] : null, body, seen);
  }

  return null;
}

/**
 * Walks a subtree looking for a nested component declaration anywhere within
 * it, short-circuiting on the first one found. Descends through every child —
 * including into conditionals, callbacks, and effects — so a component defined
 * deep inside the render body counts the same as one declared at the top.
 *
 * @param node - The subtree root (the outer function's body, or any descendant).
 * @returns `true` when the subtree contains a nested component declaration.
 */
function bodyDefinesComponent(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(bodyDefinesComponent);
  if (!isObject(node)) return false;

  if (isComponentDeclaration(node)) return true;

  return childNodes(node).some(bodyDefinesComponent);
}

/**
 * Tests whether a node declares a component: a PascalCase `function`
 * declaration that returns JSX, or a PascalCase variable declarator whose
 * initializer — seen through a `memo`/`forwardRef` wrapper — is a function that
 * returns JSX.
 *
 * @param node - The candidate declaration node.
 * @returns `true` when the node declares a component.
 */
function isComponentDeclaration(node: unknown): boolean {
  const type = getProp(node, "type");

  if (type === "FunctionDeclaration") {
    return isPascalCaseIdentifier(getProp(node, "id")) && functionReturnsJsx(node);
  }

  if (type === "VariableDeclarator") {
    if (!isPascalCaseIdentifier(getProp(node, "id"))) return false;
    const fn = unwrapToFunctionLiteral(getProp(node, "init"));
    return fn !== null && functionReturnsJsx(fn);
  }

  return false;
}

/**
 * Resolves a variable initializer to the function literal it carries, seeing
 * through transparent wrappers and `memo`/`forwardRef` calls applied to an
 * inline function. Returns `null` when the initializer is not an inline
 * function — a factory call, a `styled` expression, an identifier reference, or
 * a literal — none of which is a recognized nested component.
 *
 * @param value - The variable initializer node.
 * @returns The function literal, or `null`.
 */
function unwrapToFunctionLiteral(value: unknown): unknown {
  const node = unwrapTransparent(value);
  const type = getProp(node, "type");

  if (type === "ArrowFunctionExpression" || type === "FunctionExpression") return node;

  if (type === "CallExpression") {
    if (wrapperKind(getProp(node, "callee")) === null) return null;
    const args = getProp(node, "arguments");
    return unwrapToFunctionLiteral(Array.isArray(args) ? args[0] : null);
  }

  return null;
}

/**
 * Tests whether a function returns JSX. For an arrow with an expression body
 * the body itself is the returned value; for a block body, a `return` statement
 * carrying JSX is sought. Either way the search stops at nested-function
 * boundaries — a deeper function's returns belong to it, not to this one — so a
 * function whose own result is non-JSX is not misjudged by a JSX-returning
 * helper nested inside it.
 *
 * @param fn - The function node.
 * @returns `true` when the function itself returns JSX.
 */
function functionReturnsJsx(fn: unknown): boolean {
  const body = getProp(fn, "body");
  if (getProp(body, "type") !== "BlockStatement") return expressionContainsJsx(body);
  return blockReturnsJsx(body);
}

/**
 * Walks a block body for a `return` statement whose argument carries JSX,
 * stopping at any nested-function boundary so deeper returns are not consulted.
 *
 * @param node - The block body, or a descendant within it.
 * @returns `true` when a JSX-returning `return` statement is reached.
 */
function blockReturnsJsx(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(blockReturnsJsx);
  if (!isObject(node)) return false;

  const type = getProp(node, "type");
  if (typeof type === "string" && FUNCTION_TYPES.has(type)) return false;
  if (type === "ReturnStatement") return expressionContainsJsx(getProp(node, "argument"));

  return childNodes(node).some(blockReturnsJsx);
}

/**
 * Tests whether an expression subtree contains a JSX node, stopping at any
 * nested-function boundary. Covers JSX returned directly, through a ternary, or
 * through a `&&`, while excluding JSX produced only inside a nested callback
 * (`items.map(x => <li/>)`), which the surrounding function does not itself
 * return.
 *
 * @param node - The expression node, or a descendant within it.
 * @returns `true` when the expression itself yields JSX.
 */
function expressionContainsJsx(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(expressionContainsJsx);
  if (!isObject(node)) return false;

  const type = getProp(node, "type");
  if (type === "JSXElement" || type === "JSXFragment") return true;
  if (typeof type === "string" && FUNCTION_TYPES.has(type)) return false;

  return childNodes(node).some(expressionContainsJsx);
}

/**
 * Returns a node's child values for recursive traversal — the values of every
 * property except the `type` discriminant. Primitives among them are ignored by
 * the walkers, which act only on arrays and objects.
 *
 * @param node - The AST node to read children from.
 * @returns The node's property values, excluding `type`.
 */
function childNodes(node: object): unknown[] {
  return Object.entries(node)
    .filter(([key]) => key !== "type")
    .map(([, value]) => value);
}

/**
 * Tests whether a node is an identifier whose name is PascalCase — a leading
 * uppercase letter — matching React's component-naming convention that
 * distinguishes a component from an ordinary helper.
 *
 * @param node - The candidate identifier node.
 * @returns `true` when the node is a PascalCase identifier.
 */
function isPascalCaseIdentifier(node: unknown): boolean {
  return isIdentifier(node) && /^[A-Z]/.test(node.name);
}

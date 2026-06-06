import { getProp, isIdentifier, isObject } from "./ast-guards.js";
import {
  type ExportLookup,
  resolveExportedValue,
  resolveNamedBinding,
} from "./export-resolution.js";
import type { ParsedSource } from "./parse-source.js";
import { wrapperKind } from "./react-wrappers.js";

// Expression wrappers carrying no meaning here — parentheses, a `!` assertion,
// and TypeScript casts (`forwardRef(…) as ForwardRefComponent<…>`) — seen
// through to the value they wrap.
const TRANSPARENT_WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSNonNullExpression",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSSatisfiesExpression",
]);

// Function-literal node types — the forms the `forwardRef` render function can
// take.
const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

/**
 * Detects the dropped-ref footgun on the Component the lookup points to: the
 * Component is wrapped in `forwardRef` but never uses the forwarded `ref`. A
 * `forwardRef` wrapper is a promise to forward a consumer's ref onward; when
 * the render function ignores its ref parameter — or declares none — the
 * consumer's ref lands nowhere, silently, and `ref`-based focus, measurement,
 * and imperative handles break.
 *
 * The `ref` is the render function's second parameter. The footgun fires when
 * that parameter is absent, or present but its name never appears anywhere in
 * the function body. The body is searched with full descent — a ref is captured
 * by closure, so a legitimate use commonly sits inside an effect, a callback,
 * `useImperativeHandle(ref, …)`, or a JSX `ref={ref}` — and any identifier of
 * the ref's name counts as a use (no shadow analysis, which errs toward not
 * flagging; see ADR-0016). A `_ref`-style name is not exempt: it documents the
 * dropped ref rather than remedying it.
 *
 * The `forwardRef` may wrap the render function inline, under a `memo`
 * (`memo(forwardRef(…))`), through a polymorphic cast (`forwardRef(…) as
 * ForwardRefComponent<…>`), around a same-file binding, or be applied to the
 * Component's binding at the point of export (`const C = …; export default
 * forwardRef(C)`). Returns `false` for every Component that is not
 * `forwardRef`-wrapped, and as the quiet default when the declaration cannot be
 * analyzed (a cross-module render function, a class component, an unparseable
 * source — see ADR-0005).
 *
 * @param source - The parsed source file to inspect.
 * @param lookup - Which export to inspect: `default`, or a named export.
 * @returns `true` when the Component is a `forwardRef` that drops its ref.
 */
export function detectForwardRefWithoutRef(source: ParsedSource, lookup: ExportLookup): boolean {
  const body = getProp(source.program, "body");
  if (!Array.isArray(body)) return false;

  const resolved = resolveExportedValue(body, lookup, unwrapTransparent);
  if (resolved === null) return false;

  const render = forwardRefRenderFunction(resolved.value, lookup, body);
  if (render === null) return false;

  return refParameterUnused(render);
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
 * Locates the render function of a `forwardRef`-wrapped Component. First looks
 * for a `forwardRef` call within the resolved value — inline, under a `memo`,
 * or behind a transparent cast. Failing that, handles the export-binding shape:
 * a bare render function published as `forwardRef(name)` at a separate export,
 * where the lookup resolved to the inner binding rather than the wrapper.
 * Returns `null` when no `forwardRef` governs the Component.
 *
 * @param value - The value the lookup resolved to.
 * @param lookup - The export the Component was looked up by.
 * @param body - Top-level statements of the source file.
 * @returns The `forwardRef` render function, or `null`.
 */
function forwardRefRenderFunction(value: unknown, lookup: ExportLookup, body: unknown[]): unknown {
  const fromValue = renderFunctionFromForwardRefCall(value, body);
  if (fromValue !== null) return fromValue;

  if (lookup.kind === "named" && bindingIsForwardReffedAtExport(body, lookup.name)) {
    return resolveToFunction(value, body, new Set());
  }

  return null;
}

/**
 * Reads the render function from a `forwardRef` call reachable through the
 * value's transparent wrappers and any enclosing `memo`. Returns `null` for any
 * value that is not, beneath those wrappers, a `forwardRef` call.
 *
 * @param value - The value node to inspect.
 * @param body - Top-level statements, used to resolve an identifier argument.
 * @returns The `forwardRef` render function, or `null`.
 */
function renderFunctionFromForwardRefCall(value: unknown, body: unknown[]): unknown {
  const node = unwrapTransparent(value);
  if (getProp(node, "type") !== "CallExpression") return null;

  const kind = wrapperKind(getProp(node, "callee"));
  const args = getProp(node, "arguments");
  const firstArg = Array.isArray(args) ? args[0] : null;

  if (kind === "forwardRef") return resolveToFunction(firstArg, body, new Set());
  if (kind === "memo") return renderFunctionFromForwardRefCall(firstArg, body);
  return null;
}

/**
 * Resolves a value to a function node, seeing through transparent wrappers and
 * following a same-file binding reference (`forwardRef(Render)` where `Render`
 * is declared elsewhere in the file). Returns `null` when the value is not a
 * function in this file. `seen` guards against a self-referential binding cycle.
 *
 * @param value - The value node to resolve.
 * @param body - Top-level statements, used to resolve an identifier reference.
 * @param seen - Identifier names already followed on this path.
 * @returns The function node, or `null`.
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

  return null;
}

/**
 * Tests whether a named binding is published as `forwardRef(name)` — optionally
 * under a `memo` — at any top-level export of the file, the shape produced by
 * `const C = …; export default forwardRef(C)` (or `export const X =
 * forwardRef(C)`), where the lookup resolves to the inner binding rather than
 * the wrapper.
 *
 * @param body - Top-level statements to scan.
 * @param name - The binding name the `forwardRef` must wrap.
 * @returns `true` when an export forwards-refs the binding.
 */
function bindingIsForwardReffedAtExport(body: unknown[], name: string): boolean {
  return body.some((stmt) => statementForwardRefsIdentifier(stmt, name));
}

/**
 * Tests whether a single top-level statement publishes `forwardRef(name)` — a
 * default export of the call, or a variable declarator initialized to it.
 *
 * @param stmt - The top-level statement to inspect.
 * @param name - The binding name the `forwardRef` must wrap.
 * @returns `true` when the statement forwards-refs the binding.
 */
function statementForwardRefsIdentifier(stmt: unknown, name: string): boolean {
  const type = getProp(stmt, "type");

  if (type === "ExportDefaultDeclaration") {
    return forwardRefCallWrapsIdentifier(getProp(stmt, "declaration"), name);
  }

  const declaration = type === "ExportNamedDeclaration" ? getProp(stmt, "declaration") : stmt;
  if (getProp(declaration, "type") !== "VariableDeclaration") return false;

  const declarators = getProp(declaration, "declarations");
  return (
    Array.isArray(declarators) &&
    declarators.some((declarator) =>
      forwardRefCallWrapsIdentifier(getProp(declarator, "init"), name),
    )
  );
}

/**
 * Tests whether an expression is `forwardRef(name)` — optionally under a
 * `memo` — whose argument is the identifier `name`.
 *
 * @param expr - The expression to inspect.
 * @param name - The identifier the `forwardRef` must wrap.
 * @returns `true` when `expr` forwards-refs the named identifier.
 */
function forwardRefCallWrapsIdentifier(expr: unknown, name: string): boolean {
  const node = unwrapTransparent(expr);
  if (getProp(node, "type") !== "CallExpression") return false;

  const kind = wrapperKind(getProp(node, "callee"));
  const args = getProp(node, "arguments");
  const firstArg = Array.isArray(args) ? unwrapTransparent(args[0]) : null;

  if (kind === "memo") return forwardRefCallWrapsIdentifier(firstArg, name);
  if (kind !== "forwardRef") return false;

  return isIdentifier(firstArg) && firstArg.name === name;
}

/**
 * Tests whether a `forwardRef` render function leaves its ref unused: it
 * declares no second parameter, or declares one whose name never appears in the
 * function body. A non-identifier second parameter (a destructure or rest
 * element, which cannot meaningfully name the ref) reads as a non-footgun — the
 * quiet direction.
 *
 * @param render - The `forwardRef` render function node.
 * @returns `true` when the ref parameter is absent or unused.
 */
function refParameterUnused(render: unknown): boolean {
  const params = getProp(render, "params");
  if (!Array.isArray(params) || params.length < 2) return true;

  const refParam = params[1];
  if (!isIdentifier(refParam)) return false;

  return !identifierAppears(getProp(render, "body"), refParam.name);
}

/**
 * Tests whether an identifier of the given name appears anywhere within a
 * subtree, descending through every child — including into nested functions,
 * since a ref is captured by closure and used inside effects, callbacks, and
 * JSX. Matches `Identifier` nodes only, so a JSX attribute name (`ref={…}`'s
 * `ref`) does not count while the forwarded value (`{ref}`) does.
 *
 * @param node - The subtree root (the render function's body, or a descendant).
 * @param name - The ref parameter's name.
 * @returns `true` when an identifier of that name appears in the subtree.
 */
function identifierAppears(node: unknown, name: string): boolean {
  if (Array.isArray(node)) return node.some((child) => identifierAppears(child, name));
  if (!isObject(node)) return false;

  if (isIdentifier(node)) return node.name === name;

  return childNodes(node).some((child) => identifierAppears(child, name));
}

/**
 * Returns a node's child values for recursive traversal — the values of every
 * property except the `type` discriminant. Primitives among them are ignored by
 * the walker, which acts only on arrays and objects.
 *
 * @param node - The AST node to read children from.
 * @returns The node's property values, excluding `type`.
 */
function childNodes(node: object): unknown[] {
  return Object.entries(node)
    .filter(([key]) => key !== "type")
    .map(([, value]) => value);
}

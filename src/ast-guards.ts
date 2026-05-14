export interface IdentifierNode {
  type: "Identifier";
  name: string;
}

export interface MemberExpressionNode {
  type: "MemberExpression";
  object: unknown;
  property: unknown;
}

/**
 * Type guard for any non-null object, used as the entry check before
 * inspecting AST node fields by name.
 *
 * @param node - The value to check.
 * @returns `true` when `node` is a non-null object.
 */
export function isObject(node: unknown): node is object {
  return typeof node === "object" && node !== null;
}

/**
 * Type guard for an ESTree `Identifier` node.
 *
 * @param node - The AST node to check.
 * @returns `true` when `node` has `type: "Identifier"` and a string `name`.
 */
export function isIdentifier(node: unknown): node is IdentifierNode {
  return (
    isObject(node) &&
    getProp(node, "type") === "Identifier" &&
    typeof getProp(node, "name") === "string"
  );
}

/**
 * Type guard for an ESTree `MemberExpression` node.
 *
 * @param node - The AST node to check.
 * @returns `true` when `node` has `type: "MemberExpression"`.
 */
export function isMemberExpression(node: unknown): node is MemberExpressionNode {
  return isObject(node) && getProp(node, "type") === "MemberExpression";
}

/**
 * Safely reads a named property off any value, returning `undefined` when the
 * value is not an object. Removes the `(node as { foo?: unknown }).foo` cast
 * boilerplate when poking at oxc-parser AST nodes whose shapes are typed as
 * `unknown` after a generic guard.
 *
 * @param node - The value to read from. Non-objects return `undefined`.
 * @param key - The property name to read.
 * @returns The property value, or `undefined`.
 */
export function getProp(node: unknown, key: string): unknown {
  return isObject(node) ? (node as Record<string, unknown>)[key] : undefined;
}

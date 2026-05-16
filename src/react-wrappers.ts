import { isIdentifier, isMemberExpression } from "./ast-guards.js";

export type WrapperKind = "forwardRef" | "memo";

/**
 * Identifies a `forwardRef` / `memo` callee, whether called bare or qualified
 * (`React.forwardRef`). Only the final name segment is matched.
 *
 * @param callee - The `CallExpression.callee` node.
 * @returns The wrapper kind, or `null` for any other callee.
 */
export function wrapperKind(callee: unknown): WrapperKind | null {
  let name: string | null = null;
  if (isIdentifier(callee)) name = callee.name;
  else if (isMemberExpression(callee) && isIdentifier(callee.property)) name = callee.property.name;

  if (name === "forwardRef") return "forwardRef";
  if (name === "memo") return "memo";
  return null;
}

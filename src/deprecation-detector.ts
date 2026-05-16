import type { Comment } from "oxc-parser";
import { getProp } from "./ast-guards.js";
import { type ExportLookup, resolveExportedValue } from "./export-resolution.js";
import type { ParsedSource } from "./parse-source.js";

// Matches `@deprecated` only when it starts a JSDoc line — after the leading
// `*` decoration and optional whitespace. Prevents false positives when the
// tag literal appears inside another tag's body (e.g. `@example "{@deprecated}"`).
const DEPRECATED_TAG = /^\s*\*?\s*@deprecated\b/m;

/**
 * Detects whether the Component the lookup points to is marked deprecated via
 * a `/** @deprecated *\/` JSDoc tag on its source declaration. Mirrors the
 * TypeScript language service's own rules: strict JSDoc form only, attached
 * to the declaration the export ultimately resolves to. Patterns where the
 * export cannot be traced to a declaration (e.g. `export default forwardRef(...)`)
 * yield `false`.
 *
 * @param source - The parsed source file to inspect.
 * @param lookup - Which export to inspect: `default`, or a named export.
 * @returns `true` when a leading JSDoc on the resolved declaration contains
 *   `@deprecated`; `false` otherwise.
 */
export function detectDeprecation(source: ParsedSource, lookup: ExportLookup): boolean {
  const body = getProp(source.program, "body");
  if (!Array.isArray(body)) return false;

  const resolved = resolveExportedValue(body, lookup);
  if (resolved === null) return false;

  const declStart = getStart(resolved.declaration);
  if (declStart === null) return false;

  return hasLeadingDeprecatedJsdoc(source.comments, source.text, declStart);
}

/**
 * Reads `start` off an AST node. Returns `null` for a node that lacks a
 * numeric `start` field, including the `null` declaration of an export that
 * resolved to a value with no traceable declaration.
 *
 * @param node - The AST node, or `null`.
 * @returns The numeric start offset, or `null`.
 */
function getStart(node: unknown): number | null {
  const start = getProp(node, "start");
  return typeof start === "number" ? start : null;
}

/**
 * Checks whether the JSDoc block comment immediately preceding `declStart`
 * contains an `@deprecated` tag. A comment is considered immediately
 * preceding when only whitespace separates its `*\/` from the declaration's
 * first character — matching TypeScript's own JSDoc association rules.
 *
 * @param comments - All comments in the source file, in source order.
 * @param sourceText - The full source text, used to verify the whitespace gap.
 * @param declStart - Offset of the declaration the JSDoc must lead.
 * @returns `true` when a leading JSDoc with `@deprecated` is found.
 */
function hasLeadingDeprecatedJsdoc(
  comments: Comment[],
  sourceText: string,
  declStart: number,
): boolean {
  let leading: Comment | null = null;
  for (const comment of comments) {
    if (comment.end > declStart) break;
    if (comment.type !== "Block") continue;
    if (!comment.value.startsWith("*")) continue;
    leading = comment;
  }
  if (leading === null) return false;

  const between = sourceText.slice(leading.end, declStart);
  if (between.trim() !== "") return false;

  return DEPRECATED_TAG.test(leading.value);
}

import type { Comment } from "oxc-parser";
import { getProp, isIdentifier } from "./ast-guards.js";
import type { ExportLookup } from "./export-resolution.js";
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
  const declStart = findDeclarationStart(source, lookup);
  if (declStart === null) return false;
  return hasLeadingDeprecatedJsdoc(source.comments, source.text, declStart);
}

/**
 * Finds the source offset where the JSDoc check should anchor — the start of
 * the top-level statement that declares (or re-declares as an inline export)
 * the binding the lookup resolves to. Returns `null` when no such statement
 * exists or when the export wraps a non-traceable expression.
 *
 * @param parsed - The parsed source result.
 * @param lookup - Which export to anchor on.
 * @returns The start offset of the anchor statement, or `null`.
 */
function findDeclarationStart(parsed: ParsedSource, lookup: ExportLookup): number | null {
  const body = getProp(parsed.program, "body");
  if (!Array.isArray(body)) return null;

  if (lookup.kind === "default") return findDefaultAnchor(body);
  return findNamedAnchor(body, lookup.name);
}

/**
 * Resolves the anchor for `export default ...`. When the default exports a
 * function/class declaration, the anchor is the outer `export default`
 * statement itself. When it exports an identifier, the anchor is the
 * declaration of that local binding. Anything else (call expressions, arrow
 * functions, etc.) returns `null` — those patterns have no traceable JSDoc
 * target.
 *
 * @param body - Top-level body statements of the source program.
 * @returns The anchor offset, or `null` when no traceable declaration exists.
 */
function findDefaultAnchor(body: unknown[]): number | null {
  const exportDefault = body.find((stmt) => getProp(stmt, "type") === "ExportDefaultDeclaration");
  if (exportDefault === undefined) return null;

  const declaration = getProp(exportDefault, "declaration");
  const declType = getProp(declaration, "type");

  if (declType === "FunctionDeclaration" || declType === "ClassDeclaration") {
    return getStart(exportDefault);
  }
  if (declType === "Identifier") {
    const name = getProp(declaration, "name");
    if (typeof name !== "string") return null;
    return findNamedAnchor(body, name);
  }
  return null;
}

/**
 * Resolves the anchor for a named binding. Matches inline-exported declarations
 * (`export const Foo`, `export function Foo`, `export class Foo`) and standalone
 * declarations (`const Foo`, `function Foo`, `class Foo`). The anchor is the
 * outermost statement so the JSDoc check sees comments leading the `export`
 * keyword on inline-exported declarations.
 *
 * @param body - Top-level body statements of the source program.
 * @param name - The local binding name to find.
 * @returns The anchor offset, or `null` when no declaration matches.
 */
function findNamedAnchor(body: unknown[], name: string): number | null {
  for (const stmt of body) {
    if (getProp(stmt, "type") === "ExportNamedDeclaration") {
      const decl = getProp(stmt, "declaration");
      if (decl !== null && decl !== undefined && declarationBindsName(decl, name)) {
        return getStart(stmt);
      }
      continue;
    }
    if (declarationBindsName(stmt, name)) return getStart(stmt);
  }
  return null;
}

/**
 * Tests whether a declaration AST node binds the given identifier name.
 * Handles function/class declarations by checking `id.name`, and variable
 * declarations by scanning their declarators.
 *
 * @param node - The candidate declaration node.
 * @param name - The identifier name to look for.
 * @returns `true` when the declaration binds `name`.
 */
function declarationBindsName(node: unknown, name: string): boolean {
  const type = getProp(node, "type");
  if (type === "FunctionDeclaration" || type === "ClassDeclaration") {
    const id = getProp(node, "id");
    return isIdentifier(id) && id.name === name;
  }
  if (type === "VariableDeclaration") {
    const decls = getProp(node, "declarations");
    if (!Array.isArray(decls)) return false;
    return decls.some((d) => {
      const id = getProp(d, "id");
      return isIdentifier(id) && id.name === name;
    });
  }
  return false;
}

/**
 * Reads `start` off an AST node. Returns `null` for nodes that lack a numeric
 * `start` field (defensive — `oxc-parser` always sets these on real nodes).
 *
 * @param node - The AST node.
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

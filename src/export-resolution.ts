import { getProp, isIdentifier } from "./ast-guards.js";

export type ExportLookup = { kind: "default" } | { kind: "named"; name: string };

export interface ResolvedExport {
  // The value bound by the export: a function, class, call expression, literal…
  value: unknown;
  // Type annotation on the declared variable (`const Foo: T = …`), or `null`.
  declaredType: unknown;
}

/**
 * Resolves the export a lookup points to down to the value it binds, by
 * scanning a source program's top-level statements — no cross-file resolution.
 *
 * @param body - Top-level body statements of the source program.
 * @param lookup - Which export to resolve: `default`, or a named export.
 * @param unwrapDefault - Applied to the `export default` declaration before it
 *   is inspected, letting a caller that sees through wrapping expressions
 *   (e.g. TypeScript type casts) reach the identifier or value underneath.
 *   Defaults to the identity function.
 * @returns The bound value and its declared type annotation, or `null` when
 *   the export cannot be traced to a value in this file.
 */
export function resolveExportedValue(
  body: unknown[],
  lookup: ExportLookup,
  unwrapDefault: (node: unknown) => unknown = (node) => node,
): ResolvedExport | null {
  if (lookup.kind === "default") return resolveDefaultExport(body, unwrapDefault);
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
export function resolveNamedBinding(body: unknown[], name: string): ResolvedExport | null {
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
function bindingFromDeclaration(declaration: unknown, name: string): ResolvedExport | null {
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
 * function/class declaration or an inline expression resolves to that node; a
 * default that exports a bare identifier resolves through the local binding of
 * that name.
 *
 * @param body - Top-level body statements of the source program.
 * @param unwrapDefault - Applied to the default declaration before inspection.
 * @returns The default-exported value, or `null` when there is no default
 *   export or it cannot be traced to a value in this file.
 */
function resolveDefaultExport(
  body: unknown[],
  unwrapDefault: (node: unknown) => unknown,
): ResolvedExport | null {
  const exportDefault = body.find((stmt) => getProp(stmt, "type") === "ExportDefaultDeclaration");
  if (exportDefault === undefined) return null;

  const declaration = unwrapDefault(getProp(exportDefault, "declaration"));
  if (getProp(declaration, "type") === "Identifier") {
    const refName = getProp(declaration, "name");
    if (typeof refName !== "string") return null;
    return resolveNamedBinding(body, refName);
  }

  return { value: declaration, declaredType: null };
}

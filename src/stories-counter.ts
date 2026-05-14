import { Visitor } from "oxc-parser";
import { parseSource } from "./parse-source.js";

/**
 * Parses a CSF stories file and counts the named exports it declares. The
 * `default` export is excluded (it carries the CSF meta object, not a story),
 * and TypeScript type-only exports are excluded.
 *
 * @param sourceText - The stories file contents.
 * @param filename - The stories file path. Its extension selects the parser
 *   language (`.tsx` vs `.ts`).
 * @returns The count of named, runtime-value exports declared in the file.
 * @throws If `oxc-parser` reports a fatal parse error on the source.
 */
export function countStories(sourceText: string, filename: string): number {
  const result = parseSource(sourceText, filename);

  let count = 0;

  const visitor = new Visitor({
    ExportNamedDeclaration(node) {
      count += countNamedExport(node);
    },
  });

  visitor.visit(result.program);

  return count;
}

function countNamedExport(node: unknown): number {
  if (typeof node !== "object" || node === null) return 0;

  if ((node as { exportKind?: unknown }).exportKind === "type") return 0;

  const declaration = (node as { declaration?: unknown }).declaration;
  if (declaration !== null && declaration !== undefined) {
    return countDeclaration(declaration);
  }

  const specifiers = (node as { specifiers?: unknown }).specifiers;
  if (!Array.isArray(specifiers)) return 0;

  return specifiers.filter(isValueSpecifier).length;
}

function countDeclaration(declaration: unknown): number {
  if (typeof declaration !== "object" || declaration === null) return 0;

  const type = (declaration as { type?: unknown }).type;
  if (type === "VariableDeclaration") {
    const decls = (declaration as { declarations?: unknown }).declarations;
    return Array.isArray(decls) ? decls.length : 0;
  }
  if (type === "FunctionDeclaration" || type === "ClassDeclaration") return 1;

  return 0;
}

function isValueSpecifier(spec: unknown): boolean {
  if (typeof spec !== "object" || spec === null) return false;
  return (spec as { exportKind?: unknown }).exportKind !== "type";
}

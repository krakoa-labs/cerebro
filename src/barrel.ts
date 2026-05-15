import { type ParsedSource, parseSource } from "./parse-source.js";

export type BarrelWarningCode = "wildcard-export" | "namespace-reexport" | "default-export";

export type ExportShape =
  | "named-reexport"
  | "renamed-reexport"
  | "default-reexport"
  | "barrel-local";

export interface BarrelWarning {
  code: BarrelWarningCode;
  detail: string;
}

export interface ParsedExport {
  name: string;
  source: string | null;
  importedName: string | null;
  shape: ExportShape;
}

export interface ParsedBarrel {
  exports: ParsedExport[];
  warnings: BarrelWarning[];
}

type StaticExportEntry = ParsedSource["module"]["staticExports"][number]["entries"][number];

/**
 * Parses a barrel file and extracts its explicit named exports along with
 * warnings for shapes Cerebro does not yet support (wildcard and namespace
 * re-exports, bare default).
 *
 * @param sourceText - The barrel file contents.
 * @param filename - Path of the barrel file. Its extension determines whether
 *   the parser runs in `.ts` or `.tsx` mode.
 * @returns The list of named exports (each with the optional `from` module
 *   specifier) and the non-fatal warnings raised during parsing.
 * @throws If `oxc-parser` reports a fatal parse error on the source.
 */
export function parseBarrel(sourceText: string, filename: string): ParsedBarrel {
  const result = parseSource(sourceText, filename);

  const entries = result.module.staticExports.flatMap((stmt) => stmt.entries);

  const warnings = entries.flatMap<BarrelWarning>((entry) => {
    if (entry.exportName.kind === "None") {
      return [{ code: "wildcard-export", detail: entry.moduleRequest?.value ?? "" }];
    }
    if (entry.importName.kind === "All") {
      return [{ code: "namespace-reexport", detail: entry.moduleRequest?.value ?? "" }];
    }
    if (entry.exportName.kind === "Default") {
      return [{ code: "default-export", detail: "" }];
    }
    return [];
  });

  const exports = entries.flatMap<ParsedExport>((entry) => {
    if (entry.exportName.kind !== "Name") return [];

    // A namespace re-export (`export * as Foo from "./m"`) carries a Name
    // exportName but binds a whole module namespace, not a single Component.
    // It is flagged as a warning above and excluded from the Component list.
    if (entry.importName.kind === "All") return [];

    const name = entry.exportName.name;
    if (name === null) return [];

    const source = entry.moduleRequest?.value ?? null;
    const importedName = importedNameOf(entry, source);
    return [{ name, source, importedName, shape: classifyShape(name, source, importedName) }];
  });

  return { exports, warnings };
}

function importedNameOf(entry: StaticExportEntry, source: string | null): string | null {
  if (source === null || entry.importName.kind !== "Name") return null;

  const imp = entry.importName.name;
  if (imp === null || imp === "default") return null;

  return imp;
}

function classifyShape(
  name: string,
  source: string | null,
  importedName: string | null,
): ExportShape {
  if (source === null) return "barrel-local";
  if (importedName === null) return "default-reexport";
  if (importedName === name) return "named-reexport";
  return "renamed-reexport";
}

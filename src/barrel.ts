import { parseSync } from "oxc-parser";

export type BarrelWarningCode = "wildcard-export" | "default-export";

export interface BarrelWarning {
  code: BarrelWarningCode;
  detail: string;
}

export interface ParsedExport {
  name: string;
  source: string | null;
  importedName: string | null;
}

export interface ParsedBarrel {
  exports: ParsedExport[];
  warnings: BarrelWarning[];
}

type StaticExportEntry = ReturnType<
  typeof parseSync
>["module"]["staticExports"][number]["entries"][number];

/**
 * Parses a barrel file and extracts its explicit named exports along with
 * warnings for shapes Cerebro does not yet support (wildcard, bare default).
 *
 * @param sourceText - The barrel file contents.
 * @param filename - Path of the barrel file. Its extension determines whether
 *   the parser runs in `.ts` or `.tsx` mode.
 * @returns The list of named exports (each with the optional `from` module
 *   specifier) and the non-fatal warnings raised during parsing.
 * @throws If `oxc-parser` reports a fatal parse error on the source.
 */
export function parseBarrel(sourceText: string, filename: string): ParsedBarrel {
  const lang = filename.endsWith(".tsx") ? "tsx" : "ts";
  const result = parseSync(filename, sourceText, { sourceType: "module", lang });

  const fatalErrors = result.errors.filter((e) => e.severity === "Error");
  if (fatalErrors.length > 0) {
    throw new Error(`Failed to parse ${filename}: ${fatalErrors[0]?.message ?? "unknown error"}`);
  }

  const entries = result.module.staticExports.flatMap((stmt) => stmt.entries);

  const warnings = entries.flatMap<BarrelWarning>((entry) => {
    if (entry.exportName.kind === "None") {
      return [{ code: "wildcard-export", detail: entry.moduleRequest?.value ?? "" }];
    }
    if (entry.exportName.kind === "Default") {
      return [{ code: "default-export", detail: "" }];
    }
    return [];
  });

  const exports = entries.flatMap<ParsedExport>((entry) => {
    if (entry.exportName.kind !== "Name") return [];

    const name = entry.exportName.name;
    if (name === null) return [];

    const source = entry.moduleRequest?.value ?? null;
    return [{ name, source, importedName: importedNameOf(entry, source) }];
  });

  return { exports, warnings };
}

function importedNameOf(entry: StaticExportEntry, source: string | null): string | null {
  if (source === null || entry.importName.kind !== "Name") return null;

  const imp = entry.importName.name;
  if (imp === null || imp === "default") return null;

  return imp;
}

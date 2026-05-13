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

  const exports: ParsedExport[] = [];
  const warnings: BarrelWarning[] = [];

  for (const stmt of result.module.staticExports) {
    for (const entry of stmt.entries) {
      const exportKind = entry.exportName.kind;
      if (exportKind === "None") {
        warnings.push({
          code: "wildcard-export",
          detail: entry.moduleRequest?.value ?? "",
        });
        continue;
      }
      if (exportKind === "Default") {
        warnings.push({ code: "default-export", detail: "" });
        continue;
      }
      const name = entry.exportName.name;
      if (name === null) continue;
      const source = entry.moduleRequest?.value ?? null;
      let importedName: string | null = null;
      if (source !== null && entry.importName.kind === "Name") {
        const imp = entry.importName.name;
        if (imp !== null && imp !== "default") {
          importedName = imp;
        }
      }
      exports.push({ name, source, importedName });
    }
  }

  return { exports, warnings };
}

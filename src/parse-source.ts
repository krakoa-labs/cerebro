import { parseSync } from "oxc-parser";

export type ParsedSource = ReturnType<typeof parseSync>;

/**
 * Parses a TypeScript source file with `oxc-parser` in module mode and
 * surfaces any fatal parser errors as a thrown `Error` with a uniform
 * message shape.
 *
 * @param sourceText - The file contents.
 * @param filename - The file path. Its extension selects the parser language
 *   (`.tsx` vs `.ts`).
 * @returns The full `oxc-parser` result (program, module info, errors).
 * @throws If `oxc-parser` reports a fatal parse error.
 */
export function parseSource(sourceText: string, filename: string): ParsedSource {
  const lang = filename.endsWith(".tsx") ? "tsx" : "ts";
  const result = parseSync(filename, sourceText, { sourceType: "module", lang });

  const fatalErrors = result.errors.filter((e) => e.severity === "Error");
  if (fatalErrors.length > 0) {
    throw new Error(`Failed to parse ${filename}: ${fatalErrors[0]?.message ?? "unknown error"}`);
  }

  return result;
}

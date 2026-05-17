import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { type ParsedSource, parseSource } from "./parse-source.js";
import { resolveSourcePath } from "./source-resolution.js";
import type { AliasExpander } from "./tsconfig-aliases.js";

type StaticExportEntry = ParsedSource["module"]["staticExports"][number]["entries"][number];

/** A binding to follow into a module: its default export, or a named one. */
export type Binding = { kind: "default" } | { kind: "named"; name: string };

/** A re-export hop: a module specifier, and the binding wanted from it. */
interface Hop {
  specifier: string;
  binding: Binding;
}

/**
 * Resolves a barrel export to the file that declares the Component, following
 * re-export chains through nested `index` barrels.
 *
 * A design system routinely re-exports a Component several times: the root
 * barrel re-exports it from a folder, whose own `index` barrel re-exports it
 * from the Component file. Resolving by file-name convention alone stops at
 * the first `index` and analyzes the barrel instead of the Component; this
 * walks every `import`/`export` hop until it reaches the file that actually
 * declares the binding. When a hop cannot be resolved, the last real file
 * reached is returned — a best-effort source rather than no source at all.
 *
 * @param barrelPath - Absolute path of the root barrel file.
 * @param exportName - The Component's name as exported from the root barrel.
 * @param expandAlias - Expander for tsconfig-aliased module specifiers.
 * @returns The absolute path of the declaring file, or `null` when the export
 *   cannot be resolved out of the barrel at all.
 */
export function resolveComponentSource(
  barrelPath: string,
  exportName: string,
  expandAlias: AliasExpander,
): string | null {
  const barrel = readAndParse(barrelPath);
  if (barrel === null) return null;

  const hop = nextHop(barrel, { kind: "named", name: exportName });
  if (hop === null) return barrelPath; // the barrel declares the Component itself

  const firstFile = resolveHop(barrelPath, hop, expandAlias);
  if (firstFile === null) return null; // the export points at no resolvable module

  return followBinding(firstFile, hop.binding, expandAlias, new Set([barrelPath]));
}

/**
 * Resolves an `import` — a module specifier and the binding wanted from it,
 * read from `fromFile` — to the file that declares that binding, following
 * re-export chains the same way {@link resolveComponentSource} does.
 *
 * Used to resolve a Component's dependency edges: an import of another
 * Component through a folder barrel is followed to the Component file, so the
 * edge lands on the same file the scan registered the Component under.
 *
 * @param fromFile - The file the `import` was read from.
 * @param specifier - The `import`'s module specifier.
 * @param binding - The binding wanted from the imported module.
 * @param expandAlias - Expander for tsconfig-aliased module specifiers.
 * @returns The absolute path of the declaring file, or `null` when the
 *   specifier resolves to no file.
 */
export function resolveImportedSource(
  fromFile: string,
  specifier: string,
  binding: Binding,
  expandAlias: AliasExpander,
): string | null {
  const namedHint = binding.kind === "named" ? binding.name : null;
  const file = resolveSourcePath(dirname(fromFile), specifier, namedHint, expandAlias);
  if (file === null) return null;

  return followBinding(file, binding, expandAlias, new Set());
}

/**
 * Follows `wanted` from `file` to the file that declares it. Past the barrel,
 * resolution is best-effort: an unresolvable hop returns the file in hand
 * rather than failing the whole Component.
 *
 * @param file - The file currently being walked.
 * @param wanted - The binding to follow out of `file`.
 * @param expandAlias - Expander for tsconfig-aliased module specifiers.
 * @param visited - Files already walked, guarding against a re-export cycle.
 * @returns The absolute path of the declaring (or last reachable) file.
 */
function followBinding(
  file: string,
  wanted: Binding,
  expandAlias: AliasExpander,
  visited: Set<string>,
): string {
  if (visited.has(file)) return file; // a re-export cycle — stop here
  visited.add(file);

  const parsed = readAndParse(file);
  if (parsed === null) return file;

  const hop = nextHop(parsed, wanted);
  if (hop === null) return file; // `file` declares `wanted`

  const nextFile = resolveHop(file, hop, expandAlias);
  if (nextFile === null) return file;

  return followBinding(nextFile, hop.binding, expandAlias, visited);
}

/**
 * Resolves a hop's module specifier to a file, relative to the directory of
 * the file the hop was read from.
 *
 * @param fromFile - The file the hop was read from.
 * @param hop - The hop to resolve.
 * @param expandAlias - Expander for tsconfig-aliased module specifiers.
 * @returns The resolved file path, or `null` when none exists.
 */
function resolveHop(fromFile: string, hop: Hop, expandAlias: AliasExpander): string | null {
  const namedHint = hop.binding.kind === "named" ? hop.binding.name : null;
  return resolveSourcePath(dirname(fromFile), hop.specifier, namedHint, expandAlias);
}

/**
 * Inspects a parsed module for the export matching `wanted` and returns the
 * re-export hop to follow, or `null` when the module declares `wanted` itself.
 *
 * @param parsed - The parsed module to inspect.
 * @param wanted - The binding being looked for.
 * @returns The next hop, or `null` when `wanted` is declared in this module.
 */
function nextHop(parsed: ParsedSource, wanted: Binding): Hop | null {
  const entry = findExport(parsed, wanted);
  if (entry === undefined) return null; // not re-exported here — treat as declared

  // The local binding the export refers to: a re-export entry records it under
  // `importName`, a local export under `localName`.
  const localName = entry.moduleRequest != null ? entry.importName.name : entry.localName.name;

  // When that binding is itself imported, follow the import — this is how
  // `import X from "./m"; export { X }` is recognized as a default re-export
  // of `./m` (oxc reports such an entry's `importName` as the local name, not
  // as `default`, so the import statement is the only reliable source).
  if (localName != null) {
    const imported = findImport(parsed, localName);
    if (
      imported !== null &&
      (entry.moduleRequest == null || imported.specifier === entry.moduleRequest.value)
    ) {
      return imported;
    }
  }

  // A direct `export { x } from "./m"` carries the specifier on the entry.
  if (entry.moduleRequest != null) {
    return {
      specifier: entry.moduleRequest.value,
      binding: bindingFromImportName(entry.importName),
    };
  }

  return null; // declared locally in this module
}

/**
 * Finds the non-type export entry matching `wanted` in a parsed module.
 *
 * @param parsed - The parsed module to search.
 * @param wanted - The binding being looked for.
 * @returns The matching export entry, or `undefined` when none matches.
 */
function findExport(parsed: ParsedSource, wanted: Binding): StaticExportEntry | undefined {
  for (const statement of parsed.module.staticExports) {
    for (const entry of statement.entries) {
      if (entry.isType) continue; // a type-only export is not a Component
      const { exportName } = entry;
      if (wanted.kind === "default" && exportName.kind === "Default") return entry;
      if (
        wanted.kind === "named" &&
        exportName.kind === "Name" &&
        exportName.name === wanted.name
      ) {
        return entry;
      }
    }
  }
  return undefined;
}

/**
 * Finds the import that binds `localName` in a parsed module, as a hop into
 * the module it is imported from.
 *
 * @param parsed - The parsed module to search.
 * @param localName - The local binding name to find an import for.
 * @returns The hop into the imported module, or `null` when `localName` is
 *   not an imported binding.
 */
function findImport(parsed: ParsedSource, localName: string): Hop | null {
  for (const statement of parsed.module.staticImports) {
    for (const entry of statement.entries) {
      if (entry.localName.value === localName) {
        return {
          specifier: statement.moduleRequest.value,
          binding: bindingFromImportName(entry.importName),
        };
      }
    }
  }
  return null;
}

/**
 * Maps an `importName` record to the binding it denotes. A `default` import
 * name yields the default binding; a named one yields that name. A namespace
 * import (`import * as X`) names no single Component — it falls back to the
 * default binding, a best-effort that lets resolution continue.
 *
 * @param importName - The `importName` record from an import or export entry.
 * @returns The denoted binding.
 */
function bindingFromImportName(importName: { kind: string; name: string | null }): Binding {
  if (importName.kind === "Name" && importName.name != null) {
    return { kind: "named", name: importName.name };
  }
  return { kind: "default" };
}

/**
 * Reads and parses a file, returning `null` on any read or parse failure.
 * Resolution is best-effort, so a failure stops the walk rather than aborting
 * the scan; the final source file's own parse errors are surfaced later, when
 * the scan parses it for the per-Component detectors.
 *
 * @param file - Absolute path of the file to read.
 * @returns The parsed source, or `null` when it could not be read or parsed.
 */
function readAndParse(file: string): ParsedSource | null {
  try {
    return parseSource(readFileSync(file, "utf8"), file);
  } catch {
    return null;
  }
}

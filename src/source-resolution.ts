import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { AliasExpander } from "./tsconfig-aliases.js";

const BARREL_BASENAMES = ["index.ts", "index.tsx"];
const SOURCE_RESOLUTION_EXTS = [".tsx", ".ts"];

/**
 * Finds the barrel index file at the root of a Components root directory.
 *
 * @param componentsRoot - Absolute path to the Components root directory.
 * @returns The absolute path to the barrel index file (`index.ts` or
 *   `index.tsx`), or `null` when neither exists.
 */
export function findBarrelFile(componentsRoot: string): string | null {
  return findExistingFile(BARREL_BASENAMES.map((name) => join(componentsRoot, name)));
}

/**
 * Resolves a module specifier to the component source file it points at. A
 * relative specifier resolves against `barrelDir`; a non-relative specifier is
 * expanded through the project's tsconfig path aliases.
 *
 * @param barrelDir - Absolute directory the relative specifier resolves from.
 * @param specifier - The module specifier from an export or import.
 * @param importedName - The imported binding name, when available.
 * @param expandAlias - Expander for non-relative (tsconfig-aliased) specifiers.
 * @returns The resolved source file path, or `null` when no supported source
 *   file can be found.
 */
export function resolveSourcePath(
  barrelDir: string,
  specifier: string,
  importedName: string | null,
  expandAlias: AliasExpander,
): string | null {
  if (specifier.startsWith(".")) {
    return resolveBaseToFile(resolve(barrelDir, specifier), importedName);
  }

  for (const base of expandAlias(specifier)) {
    const resolved = resolveBaseToFile(base, importedName);
    if (resolved !== null) return resolved;
  }
  return null;
}

/**
 * Resolves a base path (a specifier without extension) to a supported source
 * file: a direct `.tsx`/`.ts` file, or — when the base is a directory — a
 * file inside it.
 *
 * @param base - The absolute base path to resolve.
 * @param importedName - The imported binding name, when available.
 * @returns The resolved source file path, or `null` when none exists.
 */
function resolveBaseToFile(base: string, importedName: string | null): string | null {
  const directFile = findExistingFile(SOURCE_RESOLUTION_EXTS.map((ext) => `${base}${ext}`));
  if (directFile !== null) return directFile;

  if (!statSync(base, { throwIfNoEntry: false })?.isDirectory()) return null;

  // When the folder holds several sibling files (e.g. FancySelect/ contains both
  // FancySelect.tsx and FancyAsyncSelect.tsx), the imported name disambiguates
  // which file is the source of THIS export.
  if (importedName !== null) {
    const named = findExistingFile(
      SOURCE_RESOLUTION_EXTS.map((ext) => join(base, `${importedName}${ext}`)),
    );
    if (named !== null) return named;
  }

  // Prefer `X/X.tsx` over `X/index.tsx`: the folder-named file is the canonical
  // Component source in most React DS conventions; `index.ts` is usually an
  // inner barrel that just re-exports it.
  const folderName = basename(base);
  const folderNamed = findExistingFile(
    SOURCE_RESOLUTION_EXTS.map((ext) => join(base, `${folderName}${ext}`)),
  );
  if (folderNamed !== null) return folderNamed;

  return findExistingFile(SOURCE_RESOLUTION_EXTS.map((ext) => join(base, `index${ext}`)));
}

/**
 * Finds the first existing file path in a candidate list.
 *
 * @param candidates - Absolute file paths to check in priority order.
 * @returns The first existing candidate, or `null` when none exist.
 */
function findExistingFile(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

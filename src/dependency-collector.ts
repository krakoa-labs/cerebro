import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { type ParsedSource, parseSource } from "./parse-source.js";
import { toPosixPath } from "./paths.js";
import { resolveSourcePath } from "./source-resolution.js";
import type { AliasExpander } from "./tsconfig-aliases.js";

/** TypeScript source extensions a Component scope is walked for. */
const SCOPE_SOURCE_EXTS = [".tsx", ".ts"];

/**
 * File suffixes excluded from a Component scope: an `import` in a test, story,
 * or Code Connect file is that file depending on a Component, not the
 * Component depending on anything.
 */
const EXCLUDED_SCOPE_SUFFIXES = [
  ".test.tsx",
  ".test.ts",
  ".spec.tsx",
  ".spec.ts",
  ".stories.tsx",
  ".stories.ts",
  ".figma.tsx",
  ".figma.ts",
];

/**
 * Directory names excluded from a Component scope walk: `__tests__` holds test
 * files, `__storybook__` holds Storybook support files (decorators, helpers).
 * An import in either is that file depending on a Component, not the Component
 * depending on anything.
 */
const EXCLUDED_SCOPE_DIRS = new Set(["__tests__", "__storybook__"]);

/** Shared scan state the dependency collector resolves imports against. */
export interface DependencyContext {
  /** Absolute path of the design system's barrel file. */
  barrelPath: string;
  /** Every Component name — the set an edge's target is checked against. */
  componentNames: Set<string>;
  /** Resolved source file path mapped to the Component names it backs. */
  pathToComponents: Map<string, string[]>;
  /** Expander for non-relative (tsconfig-aliased) import specifiers. */
  expandAlias: AliasExpander;
}

/** One `import` statement reduced to what an edge is derived from. */
interface SourceImport {
  /** The module specifier — the statement's `from` value. */
  specifier: string;
  /** The names imported by name, used to map a barrel import to Components. */
  namedBindings: string[];
}

/**
 * Collects a Component's Internal dependencies: the names of the other
 * Components its source imports. The result is computed over the Component
 * scope — a single source file, or a whole directory — with test, story, and
 * Code Connect files excluded. An edge is counted for any `import` that
 * resolves to a Component's source file, whether the specifier is relative,
 * tsconfig-aliased, or points through the design system's barrel; a source
 * file backing several Components yields one edge per Component. The list is
 * deduplicated, has the Component itself removed, and is sorted.
 *
 * @param scope - Absolute Component scope path: a source file or a directory.
 * @param selfName - The Component's own name, removed from its own edges.
 * @param context - Shared scan state imports are resolved against.
 * @param warnings - Mutable accumulator for non-fatal warnings raised during
 *   scope-file reads or parses.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns The sorted, deduplicated names of the Components imported.
 */
export function collectDependenciesForComponent(
  scope: string,
  selfName: string,
  context: DependencyContext,
  warnings: string[],
  cwd: string,
): string[] {
  const edges = new Set<string>();

  for (const file of scopeSourceFiles(scope)) {
    for (const sourceImport of importsOf(file, warnings, cwd)) {
      for (const name of resolveEdge(file, sourceImport, context)) {
        edges.add(name);
      }
    }
  }

  edges.delete(selfName);
  return [...edges].sort();
}

/**
 * Resolves one import to the Component names it creates an edge to. An import
 * resolving to the barrel is matched by binding name; an import resolving to a
 * Component's source file yields an edge to every Component that file backs;
 * anything else (a third-party package, an internal helper) yields no edge.
 *
 * @param file - The source file the import was found in.
 * @param sourceImport - The import statement reduced to specifier and bindings.
 * @param context - Shared scan state imports are resolved against.
 * @returns The Component names the import depends on.
 */
function resolveEdge(
  file: string,
  sourceImport: SourceImport,
  context: DependencyContext,
): string[] {
  const target = resolveSourcePath(
    dirname(file),
    sourceImport.specifier,
    null,
    context.expandAlias,
  );
  if (target === null) return [];

  if (target === context.barrelPath) {
    return sourceImport.namedBindings.filter((name) => context.componentNames.has(name));
  }

  return context.pathToComponents.get(target) ?? [];
}

/**
 * Reads the `import` statements of a source file. A read or parse error is
 * recorded as a warning and the file contributes no imports.
 *
 * @param file - Absolute path of the source file to read.
 * @param warnings - Mutable accumulator for non-fatal warnings.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns One entry per `import` statement.
 */
function importsOf(file: string, warnings: string[], cwd: string): SourceImport[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    warnings.push(
      `failed to read source "${toPosixPath(relative(cwd, file))}": ${(err as Error).message}`,
    );
    return [];
  }

  let parsed: ParsedSource;
  try {
    parsed = parseSource(text, file);
  } catch (err) {
    warnings.push(
      `failed to parse source "${toPosixPath(relative(cwd, file))}": ${(err as Error).message}`,
    );
    return [];
  }

  return parsed.module.staticImports.flatMap((statement) => {
    const specifier = statement.moduleRequest?.value;
    if (specifier === undefined) return [];

    const namedBindings = statement.entries.flatMap((entry) =>
      entry.importName.kind === "Name" && entry.importName.name !== null
        ? [entry.importName.name]
        : [],
    );
    return [{ specifier, namedBindings }];
  });
}

/**
 * Lists the source files of a Component scope. A file scope is the file
 * itself; a directory scope is walked recursively, keeping TypeScript source
 * files and dropping test, story, and Code Connect files.
 *
 * @param scope - Absolute Component scope path.
 * @returns The absolute paths of the scope's source files.
 */
function scopeSourceFiles(scope: string): string[] {
  const stat = statSync(scope, { throwIfNoEntry: false });
  if (stat === undefined) return [];
  if (stat.isFile()) return [scope];

  const files: string[] = [];
  walkScope(scope, files);
  return files;
}

/**
 * Recursively collects the in-scope source files under a directory.
 *
 * @param dir - The directory to walk.
 * @param acc - Mutable accumulator for the source file paths found.
 */
function walkScope(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_SCOPE_DIRS.has(entry.name)) walkScope(join(dir, entry.name), acc);
    } else if (entry.isFile() && isScopeSourceFile(entry.name)) {
      acc.push(join(dir, entry.name));
    }
  }
}

/**
 * Decides whether a file name belongs to a Component scope — a TypeScript
 * source file that is not a test, story, or Code Connect file.
 *
 * @param name - The file's base name.
 * @returns `true` when the file's imports belong to the Component.
 */
function isScopeSourceFile(name: string): boolean {
  if (!SCOPE_SOURCE_EXTS.some((ext) => name.endsWith(ext))) return false;
  return !EXCLUDED_SCOPE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

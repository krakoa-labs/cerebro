import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { type ParsedSource, parseSource } from "./parse-source.js";
import { toPosixPath } from "./paths.js";
import { type Binding, resolveImportedSource } from "./reexport-resolution.js";
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

/**
 * Node built-in module names. An import of a built-in is not an External
 * dependency — a built-in is not a package, with nothing to version, audit, or
 * migrate.
 */
const NODE_BUILTINS = new Set<string>(builtinModules);

/** Shared scan state the dependency collector resolves imports against. */
export interface DependencyContext {
  /** Resolved source file path mapped to the Component names it backs. */
  pathToComponents: Map<string, string[]>;
  /** Expander for non-relative (tsconfig-aliased) import specifiers. */
  expandAlias: AliasExpander;
  /** Reports whether a specifier matches a tsconfig `paths` alias pattern. */
  matchesPathAlias: (specifier: string) => boolean;
}

/** One `import` statement reduced to what an edge is derived from. */
interface SourceImport {
  /** The module specifier — the statement's `from` value. */
  specifier: string;
  /** The bindings the statement imports, each followed to its source file. */
  bindings: Binding[];
}

/** A Component's collected dependencies, internal and external. */
export interface ComponentDependencies {
  /** Names of the other Components imported across the Component scope. */
  dependsOn: string[];
  /** Normalized names of the external packages imported across the scope. */
  externalDependencies: string[];
}

/**
 * Collects a Component's dependencies — internal and external — over its
 * Component scope: a single source file, or a whole directory, with test,
 * story, and Code Connect files excluded.
 *
 * `dependsOn` is the names of the other Components the source imports — an edge
 * is counted for any `import` resolving to a Component's source file, whether
 * the specifier is relative, tsconfig-aliased, or points through the design
 * system's barrel, and a source file backing several Components yields one
 * edge per Component. `externalDependencies` is the names of the third-party
 * packages imported — a bare specifier (non-relative, matching no tsconfig
 * `paths` alias) reduced to its package name, with node built-ins and `react`
 * excluded. Both lists are deduplicated and sorted; `dependsOn` also has the
 * Component itself removed.
 *
 * @param scope - Absolute Component scope path: a source file or a directory.
 * @param selfName - The Component's own name, removed from its own edges.
 * @param context - Shared scan state imports are resolved against.
 * @param warnings - Mutable accumulator for non-fatal warnings raised during
 *   scope-file reads or parses.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns The Component's internal and external dependency lists.
 */
export function collectDependenciesForComponent(
  scope: string,
  selfName: string,
  context: DependencyContext,
  warnings: string[],
  cwd: string,
): ComponentDependencies {
  const edges = new Set<string>();
  const externals = new Set<string>();

  for (const file of scopeSourceFiles(scope)) {
    for (const sourceImport of importsOf(file, warnings, cwd)) {
      for (const name of resolveEdge(file, sourceImport, context)) {
        edges.add(name);
      }
      const pkg = resolveExternalPackage(sourceImport.specifier, context);
      if (pkg !== null) externals.add(pkg);
    }
  }

  edges.delete(selfName);
  return {
    dependsOn: [...edges].sort(),
    externalDependencies: [...externals].sort(),
  };
}

/**
 * Resolves one import to the Component names it creates an edge to. Each
 * imported binding is followed — through re-export chains, including the
 * design system's barrels — to the file that declares it; a binding landing
 * on a Component's source file yields an edge to every Component that file
 * backs. Anything else (a third-party package, an internal helper) yields no
 * edge.
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
  const edges: string[] = [];
  for (const binding of sourceImport.bindings) {
    const declared = resolveImportedSource(
      file,
      sourceImport.specifier,
      binding,
      context.expandAlias,
    );
    if (declared !== null) edges.push(...(context.pathToComponents.get(declared) ?? []));
  }
  return edges;
}

/**
 * Resolves one import specifier to the External dependency it creates, or
 * `null` when the specifier is not one. A specifier is an External dependency
 * when it is non-relative and matches no tsconfig `paths` alias — a bare
 * package specifier — reduced to its package name. Node built-ins and `react`
 * (the JSX runtime, constitutive of every Component) are not External
 * dependencies.
 *
 * @param specifier - The module specifier from an import statement.
 * @param context - Shared scan state, for the tsconfig `paths` predicate.
 * @returns The normalized package name, or `null` when not an External
 *   dependency.
 */
function resolveExternalPackage(specifier: string, context: DependencyContext): string | null {
  if (specifier.startsWith(".")) return null;
  if (specifier.startsWith("node:")) return null;
  if (context.matchesPathAlias(specifier)) return null;

  const pkg = packageNameOf(specifier);
  if (NODE_BUILTINS.has(pkg) || pkg === "react") return null;
  return pkg;
}

/**
 * Reduces a bare module specifier to its package name: the first path segment,
 * or the first two for a scoped package (`lodash/debounce` → `lodash`,
 * `@radix-ui/react-dialog/dist` → `@radix-ui/react-dialog`).
 *
 * @param specifier - A non-relative module specifier.
 * @returns The package name.
 */
function packageNameOf(specifier: string): string {
  const segments = specifier.split("/");
  if (specifier.startsWith("@")) return segments.slice(0, 2).join("/");
  return segments[0] ?? specifier;
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

    const bindings = statement.entries.flatMap<Binding>((entry) => {
      if (entry.importName.kind === "Default") return [{ kind: "default" }];
      if (entry.importName.kind === "Name" && entry.importName.name !== null) {
        return [{ kind: "named", name: entry.importName.name }];
      }
      return [];
    });
    return [{ specifier, bindings }];
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

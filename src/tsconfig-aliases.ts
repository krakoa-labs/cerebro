import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isObject } from "./ast-guards.js";
import { toPosixPath } from "./paths.js";

/**
 * Expands a non-relative module specifier into candidate absolute base paths
 * (no file extension), drawn from the project's tsconfig path aliases. The
 * caller resolves each base path to an actual source file. An empty result
 * means the specifier matched no alias.
 */
export type AliasExpander = (specifier: string) => string[];

/** One tsconfig file's contribution to the effective alias configuration. */
interface Layer {
  /** Absolute directory of the tsconfig file this layer was read from. */
  configDir: string;
  /** The raw `compilerOptions.baseUrl` string, or `null` when absent. */
  baseUrl: string | null;
  /** The `compilerOptions.paths` map, or `null` when the key is absent. */
  paths: Record<string, string[]> | null;
}

/** The effective alias configuration folded from a tsconfig extends chain. */
interface AliasConfig {
  /** The `paths` map: pattern to target patterns. */
  paths: Record<string, string[]>;
  /** Absolute directory that `paths` targets resolve against. */
  pathsBaseDir: string;
  /** Absolute `baseUrl` directory for bare specifiers, or `null` when unset. */
  baseUrlDir: string | null;
}

/**
 * Reads the project's `tsconfig.json` (following relative `extends` chains)
 * and returns an expander for its path aliases. TypeScript projects publish
 * their internal modules under aliases like `@/components/*`; the expander
 * turns such a specifier back into the file paths it could point at.
 *
 * The config file is optional: a missing `tsconfig.json` yields an expander
 * that matches nothing. An unreadable or malformed config yields the same
 * empty expander and a warning. Non-relative `extends` targets (npm base
 * configs) are not followed — they do not carry path aliases in practice.
 *
 * @param cwd - The project root directory.
 * @param warnings - Mutable accumulator for non-fatal warnings.
 * @returns An expander mapping a non-relative specifier to candidate absolute
 *   base paths.
 */
export function readTsconfigAliases(cwd: string, warnings: string[]): AliasExpander {
  const layers = collectLayers(join(cwd, "tsconfig.json"), cwd, warnings, new Set());
  const config = foldLayers(layers);
  if (config === null) return () => [];
  return (specifier) => (specifier.startsWith(".") ? [] : expand(specifier, config));
}

/**
 * Reads a tsconfig file and every config it extends, base-most first.
 *
 * @param requested - The requested config path (with or without `.json`).
 * @param cwd - Project root, used to format warning paths relative to it.
 * @param warnings - Mutable accumulator for non-fatal warnings.
 * @param visited - Set of already-read config files, guarding against cycles.
 * @returns The layers from the extends chain, base-most first; empty when the
 *   file is missing, already visited, or could not be read or parsed.
 */
function collectLayers(
  requested: string,
  cwd: string,
  warnings: string[],
  visited: Set<string>,
): Layer[] {
  const file = locateConfigFile(requested);
  if (file === null || visited.has(file)) return [];
  visited.add(file);

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    warnings.push(
      `failed to read tsconfig file "${toPosixPath(relative(cwd, file))}": ${(err as Error).message}`,
    );
    return [];
  }

  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch (err) {
    warnings.push(
      `failed to parse tsconfig file "${toPosixPath(relative(cwd, file))}": ${(err as Error).message}`,
    );
    return [];
  }
  if (!isObject(raw)) return [];

  const obj = raw as Record<string, unknown>;
  const configDir = dirname(file);
  const compilerOptions = isObject(obj.compilerOptions)
    ? (obj.compilerOptions as Record<string, unknown>)
    : {};

  const baseLayers = extendsTargets(obj.extends, configDir).flatMap((target) =>
    collectLayers(target, cwd, warnings, visited),
  );

  const ownLayer: Layer = {
    configDir,
    baseUrl: typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : null,
    paths: readPaths(compilerOptions.paths),
  };

  return [...baseLayers, ownLayer];
}

/**
 * Resolves a requested config path to an existing file, appending `.json`
 * when the path itself does not exist.
 *
 * @param candidate - The requested config path.
 * @returns The existing config file path, or `null` when none exists.
 */
function locateConfigFile(candidate: string): string | null {
  if (existsSync(candidate)) return candidate;
  const withJson = `${candidate}.json`;
  return existsSync(withJson) ? withJson : null;
}

/**
 * Resolves the relative `extends` targets of a tsconfig file to absolute
 * paths. `extends` may be a string or an array; non-relative entries (npm
 * package configs) are dropped.
 *
 * @param value - The raw `extends` value.
 * @param configDir - The directory of the config declaring `extends`.
 * @returns The absolute paths of the relative `extends` targets.
 */
function extendsTargets(value: unknown, configDir: string): string[] {
  const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return list
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && (entry.startsWith("./") || entry.startsWith("../")),
    )
    .map((entry) => resolve(configDir, entry));
}

/**
 * Reads a `compilerOptions.paths` value into a validated alias map. A pattern
 * is kept only when its target is a non-empty array of strings.
 *
 * @param value - The raw `paths` value.
 * @returns The validated map, or `null` when the `paths` key is absent.
 */
function readPaths(value: unknown): Record<string, string[]> | null {
  if (!isObject(value)) return null;

  const paths: Record<string, string[]> = {};
  for (const [pattern, targets] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(targets)) continue;
    const stringTargets = targets.filter((target): target is string => typeof target === "string");
    if (stringTargets.length > 0) paths[pattern] = stringTargets;
  }
  return paths;
}

/**
 * Folds an extends chain's layers into the effective alias configuration. A
 * later layer's `baseUrl` or `paths` overrides an earlier one's, and each is
 * anchored to the directory of the config file that declared it.
 *
 * @param layers - The layers from the extends chain, base-most first.
 * @returns The effective alias configuration, or `null` when no layer
 *   declares `baseUrl` or `paths`.
 */
function foldLayers(layers: Layer[]): AliasConfig | null {
  let baseUrl: string | null = null;
  let baseUrlDir = "";
  let paths: Record<string, string[]> | null = null;
  let pathsDir = "";

  for (const layer of layers) {
    if (layer.baseUrl !== null) {
      baseUrl = layer.baseUrl;
      baseUrlDir = layer.configDir;
    }
    if (layer.paths !== null) {
      paths = layer.paths;
      pathsDir = layer.configDir;
    }
  }

  if (baseUrl === null && paths === null) return null;

  const baseUrlAbs = baseUrl !== null ? resolve(baseUrlDir, baseUrl) : null;
  // `paths` targets resolve against `baseUrl` when set, otherwise against the
  // config file that declared `paths` (TypeScript's rule since 4.1).
  return {
    paths: paths ?? {},
    pathsBaseDir: baseUrlAbs ?? pathsDir,
    baseUrlDir: baseUrlAbs,
  };
}

/**
 * Expands a non-relative specifier into candidate absolute base paths. A
 * `paths` alias is tried first; a bare specifier falls back to `baseUrl`.
 *
 * @param specifier - The non-relative module specifier.
 * @param config - The effective alias configuration.
 * @returns The candidate absolute base paths, in priority order.
 */
function expand(specifier: string, config: AliasConfig): string[] {
  const matched = matchPaths(specifier, config.paths, config.pathsBaseDir);
  if (matched.length > 0) return matched;
  if (config.baseUrlDir !== null) return [resolve(config.baseUrlDir, specifier)];
  return [];
}

/**
 * Matches a specifier against the `paths` map and resolves the most specific
 * matching pattern's targets. An exact pattern outranks a wildcard one; among
 * wildcards, the longest literal prefix wins — TypeScript's selection rule.
 *
 * @param specifier - The non-relative module specifier.
 * @param paths - The `paths` map.
 * @param baseDir - The directory `paths` targets resolve against.
 * @returns The resolved absolute base paths of the best match, or empty.
 */
function matchPaths(specifier: string, paths: Record<string, string[]>, baseDir: string): string[] {
  let best: { targets: string[]; star: string | null; rank: number } | null = null;

  for (const [pattern, targets] of Object.entries(paths)) {
    const match = matchPattern(specifier, pattern);
    if (match === null) continue;
    const rank = match.star === null ? Number.POSITIVE_INFINITY : match.prefixLength;
    if (best === null || rank > best.rank) best = { targets, star: match.star, rank };
  }

  if (best === null) return [];

  const chosen = best;
  return chosen.targets.map((target) =>
    resolve(baseDir, chosen.star === null ? target : substituteStar(target, chosen.star)),
  );
}

/**
 * Matches a specifier against a single `paths` pattern.
 *
 * @param specifier - The non-relative module specifier.
 * @param pattern - The `paths` pattern, with at most one `*`.
 * @returns The captured `*` substring (`null` for an exact pattern) and the
 *   pattern's literal prefix length, or `null` when the pattern does not match.
 */
function matchPattern(
  specifier: string,
  pattern: string,
): { star: string | null; prefixLength: number } | null {
  const starIndex = pattern.indexOf("*");
  if (starIndex === -1) {
    return specifier === pattern ? { star: null, prefixLength: pattern.length } : null;
  }

  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  if (specifier.length < prefix.length + suffix.length) return null;
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;

  const star = specifier.slice(prefix.length, specifier.length - suffix.length);
  return { star, prefixLength: prefix.length };
}

/**
 * Substitutes the captured `*` value into a `paths` target pattern. A function
 * replacement is used so `$` sequences in the value are not interpreted.
 *
 * @param target - The `paths` target pattern.
 * @param star - The captured `*` substring.
 * @returns The target with its `*` replaced.
 */
function substituteStar(target: string, star: string): string {
  return target.replace("*", () => star);
}

/**
 * Parses JSON with comments and trailing commas — the format `tsconfig.json`
 * files are written in.
 *
 * @param text - The raw config file contents.
 * @returns The parsed value.
 * @throws If the comment-stripped text is not valid JSON.
 */
function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripComments(text)));
}

/**
 * Removes `//` line comments and block comments from JSONC text, leaving the
 * contents of string literals untouched.
 *
 * @param text - The JSONC text.
 * @returns The text with comments removed.
 */
function stripComments(text: string): string {
  let out = "";
  let index = 0;

  while (index < text.length) {
    const char = text.charAt(index);

    if (char === '"') {
      const end = stringLiteralEnd(text, index);
      out += text.slice(index, end);
      index = end;
      continue;
    }

    if (char === "/" && text.charAt(index + 1) === "/") {
      index += 2;
      while (index < text.length && text.charAt(index) !== "\n") index += 1;
      continue;
    }

    if (char === "/" && text.charAt(index + 1) === "*") {
      index += 2;
      while (index < text.length && !(text.charAt(index) === "*" && text.charAt(index + 1) === "/"))
        index += 1;
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/**
 * Removes commas that sit just before a closing `}` or `]`, leaving the
 * contents of string literals untouched.
 *
 * @param text - Comment-free JSON text.
 * @returns The text with trailing commas removed.
 */
function stripTrailingCommas(text: string): string {
  let out = "";
  let index = 0;

  while (index < text.length) {
    const char = text.charAt(index);

    if (char === '"') {
      const end = stringLiteralEnd(text, index);
      out += text.slice(index, end);
      index = end;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text.charAt(lookahead))) lookahead += 1;
      const next = text.charAt(lookahead);
      if (next === "}" || next === "]") {
        index += 1;
        continue;
      }
    }

    out += char;
    index += 1;
  }

  return out;
}

/**
 * Finds the index just past the end of a string literal that starts at
 * `start`, accounting for backslash escapes.
 *
 * @param text - The text being scanned.
 * @param start - The index of the opening quote.
 * @returns The index just after the closing quote (or end of text).
 */
function stringLiteralEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (char === '"') break;
  }
  return index;
}

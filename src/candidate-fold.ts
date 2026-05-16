import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { toPosixPath } from "./paths.js";

export interface FoldOptions<T> {
  candidates: string[];
  zero: T;
  label: string;
  parse: (text: string, candidate: string) => T;
  merge: (acc: T, next: T) => T;
  warnings: string[];
  cwd: string;
}

/**
 * Folds a parsed-and-merged result over a list of candidate file paths.
 * Missing files are silently skipped; read or parse errors are recorded as
 * warnings (using `label` to compose the message) and the candidate is
 * skipped without aborting the fold.
 *
 * @param opts - The fold configuration.
 * @returns The merged result over all parseable candidate files.
 */
export function foldOverCandidates<T>(opts: FoldOptions<T>): T {
  const { candidates, zero, label, parse, merge, warnings, cwd } = opts;
  return candidates.reduce<T>((acc, candidate) => {
    if (!existsSync(candidate)) return acc;

    const text = ((): string | null => {
      try {
        return readFileSync(candidate, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        const rel = toPosixPath(relative(cwd, candidate));
        warnings.push(`failed to read ${label} file "${rel}": ${(err as Error).message}`);
        return null;
      }
    })();

    if (text === null) return acc;

    try {
      return merge(acc, parse(text, candidate));
    } catch (err) {
      const rel = toPosixPath(relative(cwd, candidate));
      warnings.push(`failed to parse ${label} file "${rel}": ${(err as Error).message}`);
      return acc;
    }
  }, zero);
}

import { basename, dirname, extname, join } from "node:path";
import { Visitor } from "oxc-parser";
import { getProp, isIdentifier, isMemberExpression } from "./ast-guards.js";
import { foldOverCandidates } from "./candidate-fold.js";
import { parseSource } from "./parse-source.js";

const CODE_CONNECT_SUFFIXES = [".figma.tsx", ".figma.ts"];

/**
 * Parses a Code Connect file and counts the `figma.connect()` calls in it.
 * Each call is one Code Connect connection — a reference from a Component to a
 * component or variant in Figma. The callee is matched syntactically against
 * `figma.connect`; a renamed import of `@figma/code-connect` is not followed,
 * mirroring how the stories counter matches `storiesOf` by name.
 *
 * @param sourceText - The Code Connect file contents.
 * @param filename - The Code Connect file path. Its extension selects the
 *   parser language (`.tsx` vs `.ts`).
 * @returns The number of `figma.connect()` calls in the file.
 * @throws If `oxc-parser` reports a fatal parse error on the source.
 */
export function countConnections(sourceText: string, filename: string): number {
  const result = parseSource(sourceText, filename);

  let count = 0;
  const visitor = new Visitor({
    CallExpression(node) {
      if (isFigmaConnectCall(node)) count += 1;
    },
  });

  visitor.visit(result.program);

  return count;
}

/**
 * Sums the `figma.connect()` calls across every Code Connect file
 * (`*.figma.tsx`, `*.figma.ts`) co-located with a Component's source file.
 * Missing files are skipped; read or parse errors are recorded as warnings
 * and that file is skipped without aborting the count.
 *
 * @param componentSource - Absolute path to the Component's source file.
 * @param warnings - Mutable accumulator for non-fatal warnings raised during
 *   Code Connect file reads or parses.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns The total number of Code Connect connections, or `0` if no Code
 *   Connect file exists.
 */
export function countConnectionsForComponent(
  componentSource: string,
  warnings: string[],
  cwd: string,
): number {
  return foldOverCandidates<number>({
    candidates: codeConnectFileCandidates(componentSource),
    zero: 0,
    label: "Code Connect",
    parse: countConnections,
    merge: (acc, next) => acc + next,
    warnings,
    cwd,
  });
}

/**
 * Builds the supported Code Connect file candidates for a component source
 * file.
 *
 * @param componentSource - Absolute path to the component source file.
 * @returns Co-located Code Connect candidate file paths.
 */
function codeConnectFileCandidates(componentSource: string): string[] {
  const dir = dirname(componentSource);
  const base = basename(componentSource, extname(componentSource));

  return CODE_CONNECT_SUFFIXES.map((suffix) => join(dir, `${base}${suffix}`));
}

/**
 * Detects whether a `CallExpression` is a `figma.connect(...)` call — the Code
 * Connect connection declaration shape. The callee must be a member expression
 * of an object named `figma` with a `connect` property, which excludes other
 * Code Connect helpers (`figma.enum`, `figma.children`, …) and unrelated
 * `.connect()` calls on other objects.
 *
 * @param node - The `CallExpression` AST node to check.
 * @returns `true` if the call declares a Code Connect connection.
 */
function isFigmaConnectCall(node: unknown): boolean {
  const callee = getProp(node, "callee");
  if (!isMemberExpression(callee)) return false;
  if (!isIdentifier(callee.object) || callee.object.name !== "figma") return false;
  return isIdentifier(callee.property) && callee.property.name === "connect";
}

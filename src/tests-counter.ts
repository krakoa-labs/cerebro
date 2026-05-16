import { basename, dirname, extname, join } from "node:path";
import { Visitor } from "oxc-parser";
import { isIdentifier, isMemberExpression } from "./ast-guards.js";
import { foldOverCandidates } from "./candidate-fold.js";
import { parseSource } from "./parse-source.js";

export interface TestCounts {
  total: number;
  skipped: number;
  only: number;
}

export const ZERO_TESTS: TestCounts = { total: 0, skipped: 0, only: 0 };

const TEST_FNS = new Set(["it", "test"]);
const SKIP_PROPS = new Set(["skip", "todo"]);
const ONLY_PROP = "only";

const TEST_SUFFIXES = [".test.tsx", ".test.ts", ".spec.tsx", ".spec.ts"];

/**
 * Sums test counts across every supported test file co-located with — or in a
 * `__tests__/` folder next to — a Component's source file. Missing files are
 * skipped; read or parse errors are recorded as warnings and that file is
 * skipped without aborting the count.
 *
 * @param componentSource - Absolute path to the Component's source file.
 * @param warnings - Mutable accumulator for non-fatal warnings raised during
 *   test-file reads or parses.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @returns The summed test counts, or all-zero counts if no test file exists.
 */
export function countTestsForComponent(
  componentSource: string,
  warnings: string[],
  cwd: string,
): TestCounts {
  return foldOverCandidates<TestCounts>({
    candidates: testFileCandidates(componentSource),
    zero: ZERO_TESTS,
    label: "test",
    parse: countTests,
    merge: sumTestCounts,
    warnings,
    cwd,
  });
}

/**
 * Builds the supported test-file candidates for a component source file.
 *
 * @param componentSource - Absolute path to the component source file.
 * @returns Co-located and `__tests__` candidate file paths.
 */
function testFileCandidates(componentSource: string): string[] {
  const dir = dirname(componentSource);
  const base = basename(componentSource, extname(componentSource));
  const colocated = TEST_SUFFIXES.map((suffix) => join(dir, `${base}${suffix}`));
  const subfolder = TEST_SUFFIXES.map((suffix) => join(dir, "__tests__", `${base}${suffix}`));

  return [...colocated, ...subfolder];
}

/**
 * Sums two test-count objects field by field.
 *
 * @param acc - The current accumulated test counts.
 * @param next - The next test counts to add.
 * @returns The combined test counts.
 */
function sumTestCounts(acc: TestCounts, next: TestCounts): TestCounts {
  return {
    total: acc.total + next.total,
    skipped: acc.skipped + next.skipped,
    only: acc.only + next.only,
  };
}

/**
 * Parses a test file and counts the test cases declared in it.
 *
 * @param sourceText - The test file contents.
 * @param filename - The test file path. Its extension selects the parser
 *   language (`.tsx` vs `.ts`).
 * @returns Counts of total declared tests, those declared as skipped (via
 *   `.skip` or `.todo`), and those declared as focused (via `.only`).
 * @throws If `oxc-parser` reports a fatal parse error on the source.
 */
export function countTests(sourceText: string, filename: string): TestCounts {
  const result = parseSource(sourceText, filename);

  const counts: TestCounts = { total: 0, skipped: 0, only: 0 };

  const visitor = new Visitor({
    CallExpression(node) {
      const classification = classifyCallee(node.callee);
      if (classification === null) return;

      counts.total += 1;
      if (classification === "skipped") counts.skipped += 1;
      else if (classification === "only") counts.only += 1;
    },
  });

  visitor.visit(result.program);

  return counts;
}

/**
 * Classifies a test runner call by walking its callee chain.
 *
 * @param callee - The `CallExpression.callee` AST node to classify.
 * @returns The detected test kind, or `null` for non-test calls.
 */
function classifyCallee(callee: unknown): "test" | "skipped" | "only" | null {
  const { root, properties } = collectMemberChain(callee);

  if (!isIdentifier(root) || !TEST_FNS.has(root.name)) return null;
  if (properties.some((p) => SKIP_PROPS.has(p))) return "skipped";
  if (properties.includes(ONLY_PROP)) return "only";

  return "test";
}

/**
 * Collects the root expression and property names from a member-expression
 * chain such as `it.skip.each`.
 *
 * @param node - The AST node to walk.
 * @returns The root expression and property chain, ordered from root outward.
 */
function collectMemberChain(node: unknown): { root: unknown; properties: string[] } {
  if (!isMemberExpression(node)) return { root: node, properties: [] };

  const inner = collectMemberChain(node.object);
  const ownProp = isIdentifier(node.property) ? [node.property.name] : [];

  return { root: inner.root, properties: [...inner.properties, ...ownProp] };
}

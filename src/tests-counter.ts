import { Visitor } from "oxc-parser";
import { isIdentifier, isMemberExpression } from "./ast-guards.js";
import { parseSource } from "./parse-source.js";

export interface TestCounts {
  total: number;
  skipped: number;
  only: number;
}

const TEST_FNS = new Set(["it", "test"]);
const SKIP_PROPS = new Set(["skip", "todo"]);
const ONLY_PROP = "only";

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

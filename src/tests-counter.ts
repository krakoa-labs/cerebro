import { Visitor, parseSync } from "oxc-parser";

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
  const lang = filename.endsWith(".tsx") ? "tsx" : "ts";
  const result = parseSync(filename, sourceText, { sourceType: "module", lang });

  const fatalErrors = result.errors.filter((e) => e.severity === "Error");
  if (fatalErrors.length > 0) {
    throw new Error(`Failed to parse ${filename}: ${fatalErrors[0]?.message ?? "unknown error"}`);
  }

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

interface IdentifierNode {
  type: "Identifier";
  name: string;
}

interface MemberExpressionNode {
  type: "MemberExpression";
  object: unknown;
  property: unknown;
}

function isIdentifier(node: unknown): node is IdentifierNode {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "Identifier" &&
    typeof (node as { name?: unknown }).name === "string"
  );
}

function isMemberExpression(node: unknown): node is MemberExpressionNode {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { type?: unknown }).type === "MemberExpression"
  );
}

function classifyCallee(callee: unknown): "test" | "skipped" | "only" | null {
  const { root, properties } = collectMemberChain(callee);

  if (!isIdentifier(root) || !TEST_FNS.has(root.name)) return null;
  if (properties.some((p) => SKIP_PROPS.has(p))) return "skipped";
  if (properties.includes(ONLY_PROP)) return "only";

  return "test";
}

function collectMemberChain(node: unknown): { root: unknown; properties: string[] } {
  if (!isMemberExpression(node)) return { root: node, properties: [] };

  const inner = collectMemberChain(node.object);
  const ownProp = isIdentifier(node.property) ? [node.property.name] : [];

  return { root: inner.root, properties: [...inner.properties, ...ownProp] };
}

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

type AstNode = { type: string; [key: string]: unknown };

function classifyCallee(callee: unknown): "test" | "skipped" | "only" | null {
  let current = callee as AstNode | null;
  const properties: string[] = [];
  while (current !== null && current.type === "MemberExpression") {
    const property = current.property as AstNode | undefined;
    if (property !== undefined && property.type === "Identifier") {
      properties.unshift((property as unknown as { name: string }).name);
    }
    current = current.object as AstNode | null;
  }
  if (current === null || current.type !== "Identifier") return null;
  const name = (current as unknown as { name: string }).name;
  if (!TEST_FNS.has(name)) return null;
  if (properties.some((p) => SKIP_PROPS.has(p))) return "skipped";
  if (properties.includes(ONLY_PROP)) return "only";
  return "test";
}

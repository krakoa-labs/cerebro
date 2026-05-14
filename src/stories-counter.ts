import { Visitor } from "oxc-parser";
import { getProp, isIdentifier, isMemberExpression, isObject } from "./ast-guards.js";
import { parseSource } from "./parse-source.js";

export interface StoryBreakdown {
  total: number;
  csf1: number;
  csf2: number;
  csf3: number;
  other: number;
}

export const ZERO_STORIES: StoryBreakdown = {
  total: 0,
  csf1: 0,
  csf2: 0,
  csf3: 0,
  other: 0,
};

type ValueCategory = "csf2" | "csf3" | "other";
type StoryCategory = "csf1" | ValueCategory;

/**
 * Parses a stories file and classifies each detected story by CSF generation.
 * CSF3 stories are object-shaped named exports; CSF2 stories are function-shaped
 * named exports; CSF1 stories are `.add(...)` calls chained after `storiesOf(...)`.
 * The default export (CSF meta) and TypeScript type-only exports are excluded.
 * Anything else (e.g. `export const X = makeStory()`) lands in `other` so that
 * `csf1 + csf2 + csf3 + other === total`.
 *
 * @param sourceText - The stories file contents.
 * @param filename - The stories file path. Its extension selects the parser
 *   language (`.tsx` vs `.ts`).
 * @returns A breakdown of stories by CSF generation.
 * @throws If `oxc-parser` reports a fatal parse error on the source.
 */
export function analyzeStories(sourceText: string, filename: string): StoryBreakdown {
  const result = parseSource(sourceText, filename);
  const bindings = collectLocalBindings(result.program);

  // `total` is omitted from the live accumulator so a future visitor branch
  // can't silently overwrite it; it's computed once from the categories on
  // return.
  const counts: Record<StoryCategory, number> = { csf1: 0, csf2: 0, csf3: 0, other: 0 };

  const visitor = new Visitor({
    ExportNamedDeclaration(node) {
      for (const category of classifyExport(node, bindings)) {
        counts[category] += 1;
      }
    },
    CallExpression(node) {
      if (isCsf1AddCall(node)) counts.csf1 += 1;
    },
  });

  visitor.visit(result.program);

  return {
    total: counts.csf1 + counts.csf2 + counts.csf3 + counts.other,
    ...counts,
  };
}

/**
 * Classifies a single `ExportNamedDeclaration` AST node into zero or more
 * CSF categories. Type-only exports yield an empty result; inline declarations
 * are classified directly; specifier lists are resolved via the file-local
 * binding map.
 *
 * @param node - The `ExportNamedDeclaration` AST node to classify.
 * @param bindings - Map of locally-declared identifier names to their
 *   classification, used to resolve `export { Foo, Bar }` shapes.
 * @returns One classification per exported value (or empty for type-only
 *   exports and unknown shapes).
 */
function classifyExport(node: unknown, bindings: Map<string, ValueCategory>): ValueCategory[] {
  if (!isObject(node)) return [];
  if (getProp(node, "exportKind") === "type") return [];

  const declaration = getProp(node, "declaration");
  if (declaration !== null && declaration !== undefined) {
    return classifyDeclaration(declaration);
  }

  const specifiers = getProp(node, "specifiers");
  if (!Array.isArray(specifiers)) return [];

  return specifiers.flatMap<ValueCategory>((spec) => {
    if (!isValueSpecifier(spec)) return [];
    const local = getProp(spec, "local");
    if (!isIdentifier(local)) return ["other"];
    return [bindings.get(local.name) ?? "other"];
  });
}

/**
 * Classifies the inline `declaration` payload of an `ExportNamedDeclaration`
 * — either a `VariableDeclaration` (one classification per declarator) or
 * a `FunctionDeclaration` / `ClassDeclaration` (a single classification).
 * Type declarations (`TSTypeAliasDeclaration`, `TSInterfaceDeclaration`,
 * `TSEnumDeclaration`, …) return an empty array.
 *
 * @param declaration - The `declaration` field of an `ExportNamedDeclaration`.
 * @returns One classification per exported binding.
 */
function classifyDeclaration(declaration: unknown): ValueCategory[] {
  const type = getProp(declaration, "type");

  if (type === "VariableDeclaration") {
    const decls = getProp(declaration, "declarations");
    if (!Array.isArray(decls)) return [];
    return decls.map((d) => classifyInit(getProp(d, "init")));
  }
  if (type === "FunctionDeclaration") return ["csf2"];
  if (type === "ClassDeclaration") return ["other"];

  return [];
}

/**
 * Classifies the `init` expression of a variable declarator into a CSF
 * category by inspecting its AST node type. Arrow / function expressions are
 * CSF2; object literals are CSF3; anything else (CallExpression, Identifier,
 * missing init, etc.) falls into `other`.
 *
 * @param init - The `init` expression of a `VariableDeclarator`, or `null` /
 *   `undefined` for declarations without an initializer.
 * @returns The CSF category assigned to this binding.
 */
function classifyInit(init: unknown): ValueCategory {
  const type = getProp(init, "type");
  if (type === "ArrowFunctionExpression" || type === "FunctionExpression") return "csf2";
  if (type === "ObjectExpression") return "csf3";
  return "other";
}

/**
 * Builds a map of top-level lexical bindings in the file to their CSF
 * categories. Required to classify specifier-list exports like
 * `export { Primary, Secondary }` where the export shape itself does not
 * reveal whether each binding is an object, a function, or something else.
 *
 * @param program - The `Program` root AST node.
 * @returns Map from identifier name to its classification.
 */
function collectLocalBindings(program: unknown): Map<string, ValueCategory> {
  const bindings = new Map<string, ValueCategory>();
  const body = getProp(program, "body");
  if (!Array.isArray(body)) return bindings;

  for (const stmt of body) {
    const inner =
      getProp(stmt, "type") === "ExportNamedDeclaration" ? getProp(stmt, "declaration") : stmt;
    indexStatement(inner, bindings);
  }

  return bindings;
}

/**
 * Indexes a single top-level statement into the bindings map. Recognized
 * shapes are `VariableDeclaration`, `FunctionDeclaration`, and
 * `ClassDeclaration`; other statements are ignored.
 *
 * @param stmt - The statement AST node.
 * @param bindings - The mutable bindings map to update.
 */
function indexStatement(stmt: unknown, bindings: Map<string, ValueCategory>): void {
  const type = getProp(stmt, "type");

  if (type === "VariableDeclaration") {
    const decls = getProp(stmt, "declarations");
    if (!Array.isArray(decls)) return;
    for (const d of decls) {
      const id = getProp(d, "id");
      if (!isIdentifier(id)) continue;
      bindings.set(id.name, classifyInit(getProp(d, "init")));
    }
    return;
  }

  if (type === "FunctionDeclaration") {
    const id = getProp(stmt, "id");
    if (isIdentifier(id)) bindings.set(id.name, "csf2");
    return;
  }

  if (type === "ClassDeclaration") {
    const id = getProp(stmt, "id");
    if (isIdentifier(id)) bindings.set(id.name, "other");
  }
}

/**
 * Detects whether a `CallExpression` is an `.add(...)` call chained after a
 * `storiesOf(...)` root — the CSF1 story declaration shape. Returns `false`
 * for unrelated `.add()` calls (e.g. `set.add(x)`).
 *
 * @param node - The `CallExpression` AST node to check.
 * @returns `true` if the call counts as a CSF1 story.
 */
function isCsf1AddCall(node: unknown): boolean {
  const callee = getProp(node, "callee");
  if (!isMemberExpression(callee)) return false;
  if (!isIdentifier(callee.property) || callee.property.name !== "add") return false;
  return rootIsStoriesOfCall(callee.object);
}

/**
 * Walks down a chain of `CallExpression` / `MemberExpression` `.object` links
 * to determine whether the chain's root is a `storiesOf(...)` call.
 *
 * @param node - The expression to walk down.
 * @returns `true` if the chain root is a call to `storiesOf`.
 */
function rootIsStoriesOfCall(node: unknown): boolean {
  const type = getProp(node, "type");
  if (type === "CallExpression") {
    const callee = getProp(node, "callee");
    if (isIdentifier(callee) && callee.name === "storiesOf") return true;
    if (isMemberExpression(callee)) return rootIsStoriesOfCall(callee.object);
    return false;
  }
  if (isMemberExpression(node)) return rootIsStoriesOfCall(node.object);
  return false;
}

/**
 * Filters out type-only export specifiers (e.g. the `type Foo` in
 * `export { type Foo, Bar }`) so that only runtime-value specifiers are
 * counted as stories.
 *
 * @param spec - The export specifier AST node to check.
 * @returns `true` when `spec` is a runtime-value specifier.
 */
function isValueSpecifier(spec: unknown): boolean {
  return isObject(spec) && getProp(spec, "exportKind") !== "type";
}

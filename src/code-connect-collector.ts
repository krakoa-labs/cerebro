import { basename, dirname, extname, join } from "node:path";
import { Visitor } from "oxc-parser";
import { getProp, isIdentifier, isMemberExpression, isStringLiteral } from "./ast-guards.js";
import { foldOverCandidates } from "./candidate-fold.js";
import { resolveFigmaUrl } from "./figma-url.js";
import { parseSource } from "./parse-source.js";

const CODE_CONNECT_SUFFIXES = [".figma.tsx", ".figma.ts"];

/**
 * A single value of a Figma variant property — a variant is matched on string,
 * boolean, or number values in `figma.connect()`.
 */
export type VariantValue = string | boolean | number;

/**
 * A single Code Connect connection — one `figma.connect()` call — recorded
 * with the Figma node it targets and the variant it is scoped to.
 */
export interface FigmaConnection {
  /**
   * The connection's target URL: the second argument of `figma.connect()`
   * resolved to a Figma node URL, or `null` when it cannot be resolved to one
   * (a non-literal argument, an unresolved placeholder, a URL that does not
   * point at a Figma file and node).
   */
  url: string | null;
  /**
   * The Figma variant the connection is scoped to, drawn from the `variant`
   * field of the call's options argument. Omitted when the call declares no
   * variant; a variant key whose value is not a literal is dropped.
   */
  variant?: Record<string, VariantValue>;
}

/**
 * Parses a Code Connect file and collects every `figma.connect()` call in it.
 * Each call is one Code Connect connection — a reference from a Component to a
 * component or variant in Figma. The callee is matched syntactically against
 * `figma.connect`; a renamed import of `@figma/code-connect` is not followed,
 * mirroring how the stories counter matches `storiesOf` by name.
 *
 * @param sourceText - The Code Connect file contents.
 * @param filename - The Code Connect file path. Its extension selects the
 *   parser language (`.tsx` vs `.ts`).
 * @param substitutions - The `documentUrlSubstitutions` map used to resolve
 *   placeholder URLs.
 * @returns One `FigmaConnection` per `figma.connect()` call, in source order.
 * @throws If `oxc-parser` reports a fatal parse error on the source.
 */
export function collectConnections(
  sourceText: string,
  filename: string,
  substitutions: Record<string, string>,
): FigmaConnection[] {
  const result = parseSource(sourceText, filename);

  const connections: FigmaConnection[] = [];
  const visitor = new Visitor({
    CallExpression(node) {
      if (isFigmaConnectCall(node)) connections.push(readConnection(node, substitutions));
    },
  });

  visitor.visit(result.program);

  return connections;
}

/**
 * Collects the `figma.connect()` connections across every Code Connect file
 * (`*.figma.tsx`, `*.figma.ts`) co-located with a Component's source file.
 * Missing files are skipped; read or parse errors are recorded as warnings
 * and that file is skipped without aborting the collection.
 *
 * @param componentSource - Absolute path to the Component's source file.
 * @param warnings - Mutable accumulator for non-fatal warnings raised during
 *   Code Connect file reads or parses.
 * @param cwd - Project root, used to format warning paths relative to it.
 * @param substitutions - The `documentUrlSubstitutions` map used to resolve
 *   placeholder URLs.
 * @returns Every Code Connect connection found, or an empty array if no Code
 *   Connect file exists.
 */
export function collectConnectionsForComponent(
  componentSource: string,
  warnings: string[],
  cwd: string,
  substitutions: Record<string, string>,
): FigmaConnection[] {
  return foldOverCandidates<FigmaConnection[]>({
    candidates: codeConnectFileCandidates(componentSource),
    zero: [],
    label: "Code Connect",
    parse: (text, candidate) => collectConnections(text, candidate, substitutions),
    merge: (acc, next) => acc.concat(next),
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
 * Reads a `figma.connect()` call into a `FigmaConnection`. The URL is taken
 * from the second argument when it is a string literal, then resolved and
 * validated; any other shape yields a `null` url. The variant is read from
 * the third argument's `variant` field when present.
 *
 * @param node - The `figma.connect()` `CallExpression` AST node.
 * @param substitutions - The `documentUrlSubstitutions` map.
 * @returns The connection record.
 */
function readConnection(node: unknown, substitutions: Record<string, string>): FigmaConnection {
  const args = getProp(node, "arguments");
  const list = Array.isArray(args) ? args : [];

  const urlArgument = list[1];
  const url = isStringLiteral(urlArgument)
    ? resolveFigmaUrl(urlArgument.value, substitutions)
    : null;

  const variant = readVariant(list[2]);

  return variant ? { url, variant } : { url };
}

/**
 * Reads the `variant` field of a `figma.connect()` options argument into a
 * plain map. Each variant key is kept only when its value is a string,
 * boolean, or number literal; a key with any other value is dropped, and a
 * variant that ends up with no keys is reported as absent.
 *
 * @param optionsArgument - The third argument of the `figma.connect()` call.
 * @returns The variant map, or `undefined` when there is no usable variant.
 */
function readVariant(optionsArgument: unknown): Record<string, VariantValue> | undefined {
  const variantNode = staticProperty(optionsArgument, "variant");
  const properties = getProp(variantNode, "properties");
  if (!Array.isArray(properties)) return undefined;

  const variant: Record<string, VariantValue> = {};
  for (const property of properties) {
    const name = staticPropertyName(property);
    const value = literalValue(getProp(property, "value"));
    if (name !== null && value !== null) variant[name] = value;
  }

  return Object.keys(variant).length > 0 ? variant : undefined;
}

/**
 * Finds the value node of a statically-named property on an object
 * expression.
 *
 * @param objectExpression - The candidate `ObjectExpression` node.
 * @param name - The property name to look up.
 * @returns The property's value node, or `undefined` when absent.
 */
function staticProperty(objectExpression: unknown, name: string): unknown {
  const properties = getProp(objectExpression, "properties");
  if (!Array.isArray(properties)) return undefined;

  for (const property of properties) {
    if (staticPropertyName(property) === name) return getProp(property, "value");
  }
  return undefined;
}

/**
 * Reads the statically-known name of an object `Property` node — an identifier
 * key or a string-literal key on a non-computed property. Spread elements,
 * computed keys, and numeric keys have no usable static name.
 *
 * @param property - The candidate `Property` node.
 * @returns The property name, or `null` when it is not statically known.
 */
function staticPropertyName(property: unknown): string | null {
  if (getProp(property, "type") !== "Property") return null;
  if (getProp(property, "computed") === true) return null;

  const key = getProp(property, "key");
  if (isIdentifier(key)) return key.name;
  if (isStringLiteral(key)) return key.value;
  return null;
}

/**
 * Reads a literal AST node into its string, boolean, or number value.
 *
 * @param node - The candidate `Literal` node.
 * @returns The literal value, or `null` when the node is not a string,
 *   boolean, or number literal.
 */
function literalValue(node: unknown): VariantValue | null {
  if (getProp(node, "type") !== "Literal") return null;

  const value = getProp(node, "value");
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  return null;
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

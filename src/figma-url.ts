/**
 * Resolves the second argument of a `figma.connect()` call into the Figma
 * node URL it points at, or `null` when it cannot be resolved to one.
 *
 * Resolution first expands every `documentUrlSubstitutions` placeholder by
 * plain substring replacement — a placeholder may be a prefix, so the whole
 * string is searched. The result is then validated as a Figma node URL; an
 * unresolved placeholder, a non-Figma URL, or a "flat" URL pointing at no
 * node all fail validation and yield `null`, which the consumer can read as
 * a misconfigured connection.
 *
 * @param rawArgument - The string literal passed as the second argument of
 *   `figma.connect()`.
 * @param substitutions - The placeholder substitution map from
 *   `figma.config.json`.
 * @returns The validated Figma node URL, or `null`.
 */
export function resolveFigmaUrl(
  rawArgument: string,
  substitutions: Record<string, string>,
): string | null {
  let resolved = rawArgument;
  for (const [placeholder, value] of Object.entries(substitutions)) {
    resolved = resolved.split(placeholder).join(value);
  }

  return isFigmaNodeUrl(resolved) ? resolved : null;
}

/**
 * Checks whether a string is a Figma node URL: an `https` URL on `figma.com`
 * (with or without `www`), a `/design/` or `/file/` path carrying a non-empty
 * file key, and a non-empty `node-id` query parameter. The `node-id` value is
 * required but its internal shape is not checked, so instance node ids and
 * future formats still pass.
 *
 * @param value - The candidate URL string.
 * @returns `true` when `value` is a Figma node URL.
 */
function isFigmaNodeUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") return false;

  const [kind, fileKey] = url.pathname.split("/").filter(Boolean);
  if (kind !== "design" && kind !== "file") return false;
  if (!fileKey) return false;

  return Boolean(url.searchParams.get("node-id"));
}

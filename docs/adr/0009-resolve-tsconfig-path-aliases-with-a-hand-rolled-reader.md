# Resolve tsconfig path aliases with a hand-rolled reader

Cerebro must resolve module specifiers written as tsconfig path aliases (e.g. `@/components/*`) so that a barrel re-exporting Components through aliases still enumerates them. We resolve these with a small hand-rolled reader (`tsconfig-aliases.ts`) — JSONC parsing, relative `extends` chains, `baseUrl`/`paths` expansion — rather than adopting a resolver library.

## Considered Options

`oxc-resolver` was the obvious candidate: it belongs to the same `oxc` ecosystem as the parser (ADR-0003) and handles tsconfig resolution completely. It was rejected because it resolves a specifier all the way to a final file using standard TypeScript/Node resolution, which does not honour Cerebro's design-system convention of preferring `Button/Button.tsx` over `Button/index.ts` (see `source-resolution.ts`). Adopting it would either regress that preference or split resolution into two inconsistent paths whose results would not agree on the same Component. The hand-rolled reader instead only expands an alias into candidate base paths and feeds them to the existing, convention-aware resolver — one resolution path, consistent keys.

## Consequences

Non-relative `extends` targets (npm base configs such as `@tsconfig/*`) are not followed; they do not carry path aliases in practice. A malformed `tsconfig.json` degrades to no alias resolution plus a warning, never a failed scan.

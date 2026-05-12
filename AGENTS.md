# Agent instructions

Project-specific rules for AI agents (Claude Code, Cursor, etc.) working in this repo. These rules override the agent's global defaults where they conflict.

## Code style

### JSDoc on functions

All exported functions, classes, and methods must have JSDoc.

JSDoc should describe:

- **What the function does** — one-sentence summary on the first line.
- **`@param`** — each parameter, including destructured object fields where they are not self-explanatory.
- **`@returns`** — the return value, when the function returns something non-trivial.
- **`@throws`** — error conditions, when the function can throw.

Internal (non-exported) helpers may skip JSDoc unless their behavior is non-obvious.

Exported `interface` and `type` declarations are not required to have JSDoc when their field names are self-documenting; add JSDoc on a field only when the meaning would otherwise be ambiguous.

Example:

```ts
/**
 * Initializes Cerebro in a design system by writing the components path to a
 * project config file.
 *
 * @param options - The init options.
 * @param options.cwd - The project root directory.
 * @param options.componentsPath - Path to the components directory, absolute or
 *   relative to `cwd`.
 * @returns The resolved config path, the normalized components path, and any
 *   non-fatal warnings produced during validation.
 * @throws If the path is invalid, outside the project root, or if the config
 *   file already exists.
 */
export function init(options: InitOptions): InitResult { ... }
```

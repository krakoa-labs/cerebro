# Agent instructions

Project-specific rules for AI agents working in this repo. Override the agent's defaults where they conflict.

## Code style

### JSDoc on exported functions

All exported functions, classes, and methods must have JSDoc. Internal helpers and exported types/interfaces with self-documenting fields don't need JSDoc.

### Paragraph spacing

Break function bodies into coherent blocks with blank lines, like paragraphs in prose. Don't fragment a single tight thought (a guard right after its variable, etc.).

### Prefer immutability

Default to `const` and immutable transforms (`map` / `filter` / `reduce` / `flatMap` / `toSorted`, spread, IIFE for try/catch-computed consts). Reach for `let` only when mutation is genuinely simpler — tight AST walks, loop accumulators with branching `continue`. Never reassign function parameters.

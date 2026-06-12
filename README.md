# Cerebro

Cerebro is a CLI that scans a React/TypeScript design system and produces a deterministic JSON report of every public Component — what it exports, how it's typed, whether it's tested, what it depends on, and how it changes over time.

No telemetry. No runtime sampling. Pure static analysis and git history, always reproducible from the same commit.

## Requirements

- Node.js >= 20
- A React/TypeScript design system with a barrel file (`index.ts` or `index.tsx`) exporting its public Components

## Install

Clone and build:

```bash
git clone https://github.com/krakoa-labs/cerebro.git
cd cerebro
pnpm install
pnpm build
```

Link globally for use in any design system:

```bash
pnpm link --global
cerebro --help
```

## Quick start

```bash
# 1. Initialize — creates cerebro.config.json
cerebro init

# 2. Scan — emits a JSON Scan result to stdout
cerebro scan
```

## What it detects

For every Component exported from your public barrel, Cerebro reports:

| Category | Indicators |
| --- | --- |
| **Inventory** | Component name, source path, export shape (named/renamed/default/barrel-local), definition kind (function/class) |
| **Quality** | Props typing (typed/untyped), test count (total/skipped/only), deprecation status |
| **Storybook** | Story count by CSF generation (CSF1/CSF2/CSF3) — when Storybook is detected |
| **Figma** | Code Connect connections with resolved Figma URLs — when `@figma/code-connect` is detected |
| **Dependencies** | Internal Component-to-Component edges (`dependsOn`), external package imports |
| **Activity** | Recent commits touching each Component's scope (count configurable) — when in a git repo |
| **Footguns** | Inert `memo()` with element-typed children, nested component definitions, `forwardRef` that drops the ref |

## Configuration

`cerebro init` writes a `cerebro.config.json` at your project root:

```jsonc
{
  "componentsPath": "src/components",
  "usesStorybook": true,
  "usesFigmaCodeConnect": false,
  "tracksActivityLog": true,
  "activityLogDepth": 20
}
```

| Field | Description |
| --- | --- |
| `componentsPath` | Directory containing the public barrel index |
| `usesStorybook` | Enables story counting indicators |
| `usesFigmaCodeConnect` | Enables Code Connect connection collection |
| `tracksActivityLog` | Enables per-Component git activity logs |
| `activityLogDepth` | Number of recent commits per Component (default: 20) |

## Example output

```jsonc
{
  "schemaVersion": 1,
  "toolVersion": "0.0.0",
  "scannedCommit": "a1b2c3d",
  "components": [
    {
      "name": "Button",
      "path": "src/components/Button/Button.tsx",
      "deprecated": false,
      "exportShape": "named-reexport",
      "propsTyping": "typed",
      "definitionKind": "function",
      "tests": { "total": 12, "skipped": 0, "only": 0 },
      "stories": { "total": 8, "csf1": 0, "csf2": 3, "csf3": 5 },
      "dependsOn": ["Icon", "Spinner"],
      "externalDependencies": ["@radix-ui/react-slot", "clsx"]
    }
  ],
  "warnings": [],
  "git": { "available": true, "shallow": false }
}
```

## Development

```bash
pnpm install
pnpm build          # Compile with tsup
pnpm test           # Run vitest
pnpm typecheck      # tsc --noEmit
pnpm lint           # Biome check
```

## Documentation

- [Domain language](./CONTEXT.md)
- [Architectural decisions](./docs/adr/)

## License

[MIT](./LICENSE)

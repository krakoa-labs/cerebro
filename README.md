# Cerebro

> Locate every component across your apps.

Cerebro is an open-source CLI that scans React/TypeScript design systems and produces deterministic indicators describing their inventory, internal quality, and history.

## Status

Pre-1.0, under active development. APIs and output formats may change.

## Install

```bash
npx @krakoa-labs/cerebro --help
```

Or install globally:

```bash
npm install -g @krakoa-labs/cerebro
cerebro --help
```

## Usage

### Initialize

Run `init` from the root of your design system to create a `cerebro.config.json`. Cerebro auto-detects your components directory, Storybook, Figma Code Connect, and git:

```bash
cerebro init
```

Or pass the path explicitly:

```bash
cerebro init src/ui
```

### Scan

Run `scan` to analyze every Component exported from your public barrel. Cerebro emits a deterministic JSON **Scan result** — inventory, internal quality indicators, git activity, dependencies, and more:

```bash
cerebro scan
```

The result is printed to stdout and cached to `.cerebro/scan.json`.

### Example output

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
      "dependsOn": ["Icon", "Spinner"],
      "externalDependencies": ["@radix-ui/react-slot", "clsx"]
    }
  ]
}
```

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile with tsup
npm test           # Run vitest
npm run typecheck  # tsc --noEmit
npm run lint       # Biome check
```

## Documentation

- [Domain language](./CONTEXT.md)
- [Architectural decisions](./docs/adr/)

## License

[MIT](./LICENSE)

# Fixtures

This directory holds minimal fake design systems used to validate Cerebro scans.

## Convention

- Each subdirectory is one **fixture**: a self-contained, minimal design system shape that Cerebro must handle.
- Every fixture is paired with at least one test that scans it and asserts the expected indicators.
- Fixtures are created **lazily**: a fixture exists only because a specific feature needed it. We do not pre-populate speculative shapes.
- Keep each fixture as small as possible while still exercising the shape it represents.

## Adding a fixture

1. Create a subdirectory with a name describing the shape (e.g. `barrel-exports/`, `single-file-components/`).
2. Add the minimal source files needed to exercise the shape.
3. Add or extend a test that scans the fixture and asserts the expected indicators.

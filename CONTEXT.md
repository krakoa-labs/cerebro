# Cerebro

Cerebro is an open-source CLI that scans React/TypeScript design systems and produces deterministic indicators describing their inventory, internal quality, and history. The indicators are intended to feed a future web dashboard and to help design system teams make informed decisions about adoption, migration, and maintenance.

## Language

**Design system**:
A React/TypeScript codebase that exposes a curated set of reusable UI components, tokens, and patterns for consumption by other applications.
_Avoid_: Component library (overlaps but is narrower)

**Scan**:
A single, deterministic analysis run of a design system that produces a complete set of indicators.
_Avoid_: Crawl, parse, inspect

**Indicator**:
A deterministic value produced by a scan — for example an inventory count or an internal quality measure — derived purely from static analysis and git history.
_Avoid_: Metric (implies telemetry or runtime sampling), measurement, stat

**Component**:
An entity that the design system exposes through its public barrel exports — i.e. something a consuming application can import from the design system. Implementation details (helpers, internal subcomponents, render utilities) are not Components even when they look like React entities in source.
_Avoid_: Widget, Element, Composant (use English in repo)

**Components root**:
The directory of the design system that holds the public barrel index from which Components are enumerated. Its location is recorded as `componentsPath` in `cerebro.config.json`.
_Avoid_: Components folder, src/components (only one of several conventional layouts)

**Storybook usage**:
A persisted attribute of a Design system that records whether the team uses Storybook. Recorded as `usesStorybook` in `cerebro.config.json`. Gates Storybook-related Indicators so they are only computed for Design systems that actually adopt the tool.
_Avoid_: Storybook detection (implies a one-off check rather than a persisted attribute)

**Deprecation**:
A boolean Indicator per Component, true when the Component's source declaration carries a `/** @deprecated */` JSDoc tag. Mirrors what TypeScript and IDEs surface at usage sites, so Cerebro's verdict matches what a developer already sees in their editor.
_Avoid_: Legacy, sunset, obsolete (vaguer terms; "legacy" especially conflates "old" with "marked-for-removal")

**Export shape**:
A categorical Indicator per Component describing the form of the barrel statement that publishes it. Values: `named-reexport` (`export { Button } from "./Button"`), `renamed-reexport` (`export { Button as PrimaryButton } from "./Button"`), `default-reexport` (`export { default as Button } from "./Button"`), `barrel-local` (declared directly in the barrel, e.g. `export const Button = ...`). Captures the *form of the publication statement* — not the form of the source-file declaration, which is invisible to consumers and therefore not a property of the Component.
_Avoid_: Export type (overloaded with TypeScript "type" and ambiguous with source-file form), export style (subjective/evaluative), export kind (too generic)

**Fixture**:
A minimal fake design system kept under `fixtures/` whose sole purpose is to exercise a specific shape Cerebro must handle. Each fixture is paired with at least one test that asserts the expected indicators.
_Avoid_: Example (implies user-facing demo), sample, test data

**DS developer**:
Persona who maintains the design system and uses Cerebro to understand its state and evolution day-to-day.

**Lead DS**:
Persona who owns the design system strategy and uses Cerebro indicators to make decisions about scope, migration, and adoption across consuming applications.

## Relationships

- A **Scan** operates on a **Design system** and produces a set of **Indicators**
- A **Component** is enumerated from the public barrel exports of a **Design system**'s **Components root**
- A **Fixture** is a minimal **Design system** used to validate Cerebro scans in tests
- A **DS developer** runs **Scans**; a **Lead DS** consumes the **Indicators** they produce
- **Storybook usage** is an attribute of a **Design system**, set at init time, that gates Storybook-related Indicators
- A **Component** carries a **Deprecation** indicator, derived from the `@deprecated` JSDoc tag on its source declaration
- A **Component** carries an **Export shape** indicator, derived from the barrel statement that publishes it

## Example dialogue

> **Lead DS:** "What do you mean by **indicator** — is that the same as a metric we'd see on a dashboard?"
> **Dev:** "An **indicator** is the deterministic output of a **scan** — for example 'Button is exported from three locations in this **design system**'. It's derived from static analysis and git history, so the same codebase always produces the same indicators. That's the whole point: no telemetry, no runtime sampling."

## Flagged ambiguities

- "metric" was initially used interchangeably with **Indicator** — resolved: indicators are deterministic snapshots from static analysis, not telemetry. The project deliberately avoids "metric" to preserve this distinction.
- "component" was initially ambiguous between three possible definitions: (a) what the design system publicly exports, (b) every React function/class declared in source, or (c) every PascalCase file under the components root. Resolved: a **Component** is (a). Things matching (b) or (c) but not exposed via the public barrel are **internal entities**, tracked separately by a future indicator (planned: "internal component not exported", not implemented yet).
- "export type" / "type d'export" was initially ambiguous between (a) the form of the *publication statement in the barrel* and (b) the form of the *export at the source file* (named vs default, `function` vs `const`, etc.). Resolved as (a), now named **Export shape**. The source-file form is excluded because it is a pure code-style question (the file's choice of `export function` vs `export const`), not a substantive property of the Component — that level of source-style consistency is a linter's job, not Cerebro's. General rule that fell out of this discussion: Cerebro indicators measure substantive properties of a Component — quality, status, exposure, technical debt — including internal signals invisible to consumers (tests, stories). Code-style consistency questions are deferred to linters.

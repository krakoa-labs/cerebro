# Cerebro

Cerebro is an open-source CLI that scans React/TypeScript design systems and produces deterministic indicators describing their inventory and internal quality, plus per-Component raw records for a consumer to interpret — a git-history activity log and a list of Figma Code Connect connections. These outputs are intended to feed a future web dashboard and to help design system teams make informed decisions about adoption, migration, and maintenance.

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

**Code Connect usage**:
A persisted attribute of a Design system that records whether the team uses Figma Code Connect. Recorded as `usesFigmaCodeConnect` in `cerebro.config.json`, detected at init from the presence of `@figma/code-connect` in the project's `package.json` (`dependencies` or `devDependencies`). Gates the Code Connect connection count so it is only computed for Design systems that actually adopt the tool.
_Avoid_: Code Connect detection (implies a one-off check rather than a persisted attribute)

**Deprecation**:
A boolean Indicator per Component, true when the Component's source declaration carries a `/** @deprecated */` JSDoc tag. Mirrors what TypeScript and IDEs surface at usage sites, so Cerebro's verdict matches what a developer already sees in their editor.
_Avoid_: Legacy, sunset, obsolete (vaguer terms; "legacy" especially conflates "old" with "marked-for-removal")

**Export shape**:
A categorical Indicator per Component describing the form of the barrel statement that publishes it. Values: `named-reexport` (`export { Button } from "./Button"`), `renamed-reexport` (`export { Button as PrimaryButton } from "./Button"`), `default-reexport` (`export { default as Button } from "./Button"`), `barrel-local` (declared directly in the barrel, e.g. `export const Button = ...`). Captures the *form of the publication statement* — not the form of the source-file declaration, which is invisible to consumers and therefore not a property of the Component.
_Avoid_: Export type (overloaded with TypeScript "type" and ambiguous with source-file form), export style (subjective/evaluative), export kind (too generic)

**Props typing**:
A categorical Indicator per Component describing whether the Component's props carry a TypeScript type annotation. Values: `typed` (a type annotation governs the props — a parameter annotation, or the props generic argument of an `FC`/`forwardRef`/`memo` form; a Component that accepts no props is also `typed`, its contract being trivially complete), `untyped` (a function-component declaration with a props parameter was found and no annotation governs it), `unanalyzed` (no analyzable function-component declaration could be identified — deeply-wrapped HOCs, class components, barrel-local non-components, and shapes not yet supported all fall here). Reports only the *presence* of a type annotation, not its soundness: `props: any` counts as `typed`.
_Avoid_: Typed props (implies a settled boolean), Props coverage (suggests a percentage like test coverage), Type safety (a verdict — Props typing does not judge `any` or weak types)

**Code Connect connection**:
A reference from a Component in the design system's code to a node (a component or variant) in Figma, declared by a single `figma.connect()` call in a Code Connect file (`*.figma.tsx` / `*.figma.ts`) co-located with the Component's source file. Recorded per Component as `figmaConnections` — a list with one entry per call, gated by Code Connect usage. Each entry carries the connection's Figma `url` (the address of the target node) and an optional `variant` map drawn from the call's arguments. The `url` is `null` when it cannot be resolved to a valid Figma node URL — an unresolved placeholder, a non-literal argument, or an address that does not point to both a file and a node. The list is raw scan output handed to a consumer, *not* an Indicator: the connection count is `figmaConnections.length`, and a verdict such as "this Component has broken connections" is left to the consumer to derive from the `null` URLs.
_Avoid_: Code Connect file (names the container — one file can declare several connections), Code Connect coverage (suggests a percentage like test coverage), Code Connect connection count (the output is a list — the count is derivable, not stored)

**Activity log**:
A per-Component category of scan output — the list, newest first by committer date, of the most recent commits that touched its Component scope. An Activity log is *not* an Indicator: it is raw recorded git history handed to a consumer (such as the future dashboard) to interpret, not a derived verdict that surfaces a decision on its own. Each entry carries the commit's full SHA, committer date, author name and email, and subject. The number of commits is a fixed count (default 20, configurable via `activityLogDepth`) and deliberately not a time window — a wall-clock window would make a Scan depend on the day it runs and break its determinism, so date-based views are left to the consumer.
_Avoid_: Commit history, changelog, git log, "history" (too vague — names the source, not the output)

**Component scope**:
The per-Component path a scope-based scan output is computed over: the Component's directory when that Component alone resolves its source file there, otherwise the source file by itself. The directory form folds in co-located styles and internal subcomponents; the file fallback keeps the scope unambiguous when several Components share a directory.
_Avoid_: Git scope (former name — the concept is not git-specific), Component path (that term names the resolved source file specifically), component folder

**Activity log tracking**:
A persisted attribute of a Design system recording whether the team wants Activity logs computed. Recorded as `tracksActivityLog` in `cerebro.config.json`, defaulted at init from whether the project is a git repository. Gates the Activity log, which is *additionally* gated at scan time by actual git availability — git presence is an environmental fact, not committed code, so a persisted flag alone cannot guarantee it.
_Avoid_: Git usage (the attribute is about wanting the output, not about using git)

**Internal dependency**:
A reference from one Component to another Component of the same design system, recorded when the first Component's source imports the second. Recorded per Component as `dependsOn` — the deduplicated, self-excluded, alphabetically-sorted list of the names of the Components it imports, computed over its Component scope (test, story and Code Connect files excluded). An edge is counted for any `import` resolving to a Component's source file — used or not, value or type-only — and a source file backing several Components yields one edge per Component. `dependsOn` is omitted when the Component's own source file cannot be parsed. An Internal dependency is *not* an Indicator: `dependsOn` is a raw edge list handed to a consumer, like the Activity log — fan-in (the Components that import this one) and fan-out (`dependsOn.length`) are verdicts the consumer derives, not stored values.
_Avoid_: Coupling (a verdict — Internal dependency does not judge), dependency graph (names the whole graph, not the per-Component edge list), import (names the mechanism, not the Component-to-Component relationship)

**External dependency**:
A reference from a Component to a third-party package, recorded when the Component's source imports it. Recorded per Component as `externalDependencies` — the deduplicated, alphabetically-sorted list of package names it imports, each normalized from the import's module specifier to its package name (`lodash/debounce` → `lodash`, `@radix-ui/react-dialog/dist` → `@radix-ui/react-dialog`). A specifier is an External dependency when it is non-relative and matches no tsconfig path alias — a bare package specifier — regardless of whether it resolves to an installed package; relative and alias-matching specifiers are internal. Computed over the Component scope with the same import reading as `dependsOn`: static `import` statements only (named, default, type-only, and side-effect), test, story and Code Connect files excluded. `react` is excluded — it is the JSX runtime, constitutive of every Component rather than a chosen library (see ADR-0010) — as are node built-ins, which are not packages. `externalDependencies` is omitted when the Component's own source file cannot be parsed. Like `dependsOn`, an External dependency is *not* an Indicator: it is a raw record handed to a consumer to interpret.
_Avoid_: Third-party import (names the mechanism, not the Component-to-package relationship), package dependency (redundant), peer dependency (a `package.json` relationship, not what Cerebro records from source)

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
- **Code Connect usage** is an attribute of a **Design system**, set at init time, that gates the **Code Connect connection** count
- A **Component** carries a **Deprecation** indicator, derived from the `@deprecated` JSDoc tag on its source declaration
- A **Component** carries an **Export shape** indicator, derived from the barrel statement that publishes it
- A **Component** carries a **Props typing** indicator, derived from the type annotation governing its props parameter (or its absence)
- A **Component** carries a list of **Code Connect connections** — one entry per `figma.connect()` call in its co-located Code Connect files, each with a Figma URL — produced only when **Code Connect usage** is on
- A **Component** carries an **Activity log**, the recent commits touching its **Component scope** — produced only when **Activity log tracking** is on and the **Design system** is a git repository
- **Activity log tracking** is an attribute of a **Design system**, set at init time from git detection, that gates the **Activity log**
- A **Component** carries a list of **Internal dependencies**, the other Components imported across its **Component scope** — recorded as `dependsOn`, omitted when its source file cannot be parsed
- A **Component** carries a list of **External dependencies**, the third-party packages imported across its **Component scope** — recorded as `externalDependencies`, omitted when its source file cannot be parsed

## Example dialogue

> **Lead DS:** "What do you mean by **indicator** — is that the same as a metric we'd see on a dashboard?"
> **Dev:** "An **indicator** is the deterministic output of a **scan** — for example 'Button is exported from three locations in this **design system**'. It's derived from static analysis and git history, so the same codebase always produces the same indicators. That's the whole point: no telemetry, no runtime sampling."
>
> **Lead DS:** "Then can the **Activity log** tell me which Components are going stale?"
> **Dev:** "Not on its own — an **Activity log** is just the raw recent commits for a Component, it doesn't judge. The dashboard can derive 'stale' from the commit dates. If we wanted Cerebro itself to verdict on staleness, that would be a new **Indicator**, separate from the log."
>
> **Lead DS:** "And `dependsOn` — can it tell me which Component is riskiest to change?"
> **Dev:** "Not by itself. `dependsOn` is the raw **Internal dependency** edges — A imports B. The dashboard inverts them to get fan-in: how many Components import Button. 'Riskiest' is a verdict the consumer builds on top of the edges — Cerebro stores the edges, not the verdict."

## Flagged ambiguities

- "metric" was initially used interchangeably with **Indicator** — resolved: indicators are deterministic snapshots from static analysis, not telemetry. The project deliberately avoids "metric" to preserve this distinction.
- "component" was initially ambiguous between three possible definitions: (a) what the design system publicly exports, (b) every React function/class declared in source, or (c) every PascalCase file under the components root. Resolved: a **Component** is (a). Things matching (b) or (c) but not exposed via the public barrel are **internal entities**, tracked separately by a future indicator (planned: "internal component not exported", not implemented yet).
- "export type" / "type d'export" was initially ambiguous between (a) the form of the *publication statement in the barrel* and (b) the form of the *export at the source file* (named vs default, `function` vs `const`, etc.). Resolved as (a), now named **Export shape**. The source-file form is excluded because it is a pure code-style question (the file's choice of `export function` vs `export const`), not a substantive property of the Component — that level of source-style consistency is a linter's job, not Cerebro's. General rule that fell out of this discussion: Cerebro indicators measure substantive properties of a Component — quality, status, exposure, technical debt — including internal signals invisible to consumers (tests, stories). Code-style consistency questions are deferred to linters.
- "props typing" was initially entangled with props *quality* — resolved: **Props typing** reports only whether a type annotation is *present*, not whether it is sound. Whether a prop type is `any` or otherwise weak is a separate, deferred indicator. Consistent with the Export shape rule: an indicator measures one substantive property and does not bundle a quality verdict.
- "history" was ambiguous between (a) a raw list of recent commits and (b) a derived verdict about activity or staleness. Resolved: the raw list is an **Activity log**, deliberately *not* an Indicator — "Indicator" stays reserved for derived deterministic values that surface a decision. A staleness or churn verdict, if ever needed, would be a separate future Indicator built on top of the log.
- a time-windowed activity log ("commits in the last 90 days") was considered and rejected: a wall-clock window makes a **Scan**'s output depend on the date it runs — the same repository state would yield a different log a month later — which contradicts the determinism that defines a Scan. The **Activity log** is a fixed count instead; date filtering is left to the consumer, which can use the committer date on each entry.
- "Git scope" was renamed to **Component scope** when a second scan output — a Component's internal dependency record — was found to need the same per-Component dir-or-file path resolution. The concept was never git-specific; it was only first used by the Activity log. The Activity log computes git history over the Component scope; the dependency record parses imports over it.
- "connection" (Code Connect) was ambiguous between (a) a `.figma.tsx` file, (b) a `figma.connect()` call, and (c) a Figma node. Resolved as (b): a **Code Connect connection** is one `figma.connect()` call — the declarative unit. A single file can hold several calls (typically one per Figma variant), so the file count carries no decision-relevant signal; the Figma node is the *target* of a connection, not the connection itself.
- the **Code Connect connection** output was initially a count (`figmaConnections: number`, an Indicator) — resolved into a list, one entry per `figma.connect()` call, each carrying the connection's Figma URL. The reclassification follows the **Activity log** precedent: a list of URLs is navigational raw data the consumer turns into links, not a verdict that surfaces a decision, so it is *not* an Indicator. The stored count is dropped because it is derivable (`figmaConnections.length`) and a stored copy could drift from the list. A connection whose URL does not resolve is kept in the list with `url: null` rather than dropped — dropping it would understate the count and hide a configuration problem, whereas the `null` is a deliberate quality-bearing signal the consumer can act on.
- the internal dependency output was initially framed as fan-in / fan-out **Indicators**. Resolved into a per-Component raw edge list (`dependsOn`), deliberately *not* an Indicator — following the **Activity log** and **Code Connect connection** precedent that an edge list is navigational raw data a consumer interprets, not a verdict that surfaces a decision. Fan-out is derivable (`dependsOn.length`) and fan-in by inverting the edge lists across the scan, so neither is stored — a stored copy could drift, the same reason the `figmaConnections` count was dropped.
- detecting an **Internal dependency** was ambiguous between (a) a Component's source *imports* another and (b) a Component's source *renders* the other in JSX. Resolved as (a), import-based: it is deterministic and cheap (static `import` analysis) and stays in the "what the code declares" register that **Deprecation** and **Props typing** occupy, rather than the "what the code does" register. The cost — an imported-but-unrendered Component counts as an edge — is accepted: it over-reports slightly, the safe direction for a record meant to surface change blast radius.
- detecting an **External dependency** was ambiguous between (a) a module specifier that fails to resolve to a local source file and (b) a bare specifier — non-relative and matching no tsconfig path alias. Resolved as (b): rule (a) would misclassify an internal alias that happens not to resolve (a `.js` target, an unsupported folder layout) as external. Whether a bare specifier resolves to an installed package is not consulted — a bare specifier *is* the External dependency.
- excluding `react` from **External dependency** is a deliberate deviation from the principle — followed by **Internal dependency**, the **Activity log** and the **Code Connect connection** — that a raw record records everything it finds without filtering. Resolved and kept: `react` is the JSX runtime, so every Component depends on it by construction; recording it would add a guaranteed-present entry carrying no signal. The exclusion is `react` alone — `react-dom` is a deliberate, optional import (`createPortal`, `flushSync`) and is recorded. Node built-ins are also absent, but on a separate ground: they are not packages (no version, no `package.json`), so they fall outside the concept rather than being a filtered exception. See ADR-0010.

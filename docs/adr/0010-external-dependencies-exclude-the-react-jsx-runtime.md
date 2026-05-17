# External dependencies exclude react, the JSX runtime

A Component's `externalDependencies` record lists the third-party packages its source imports, but deliberately omits `react`. Cerebro's other raw records (`dependsOn`, the activity log, the Code Connect connections) record everything they find without filtering; excluding `react` is a deliberate exception, made because `react` is the JSX runtime — every Component compiles its JSX into calls into it, so a dependency on `react` is constitutive of being a React Component, not a distinguishing fact. Recording it would add a guaranteed-present entry to nearly every Component that tells a consumer nothing.

## Considered Options

Recording `react` like any other package was the consistent choice — it is a real npm package, version-bearing and migration-relevant (React 18 → 19). It was rejected because the entry would be present on essentially every Component and carry no discriminating signal, drowning the genuinely informative entries. Excluding all `peerDependencies` was considered as a principled rule rather than a one-package exception, but it over-excludes: a design system can peer-depend on packages a consumer genuinely wants audited (an icon set, a Radix primitive), and it would also drop `react-dom`.

## Consequences

The exclusion is `react` alone. `react-dom` is kept: importing it is a deliberate, optional act (`createPortal`, `flushSync`), not a constitutive one. Node built-ins are also absent from `externalDependencies`, but on a separate ground — they are not packages (no version, no `package.json`, nothing to audit or migrate), so they fall outside the concept entirely rather than being a filtered exception.

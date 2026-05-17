# Source resolution follows re-export chains

A barrel export rarely points straight at the file that declares a Component.
A design system re-exports a Component through nested `index` barrels —
`export { SelectOnly as Combobox }` from the root barrel, `SelectOnly`
re-exported again by `Combobox/index.ts`, declared in `Combobox/SelectOnly/`.
Source resolution now parses each `import`/`export` hop and follows the chain
to the file that actually declares the binding, instead of guessing the file
from naming convention and stopping at the first `index` barrel.

Directory resolution is *import-kind-aware*. A default import of a folder
(`import Menu from "./Menu"`) addresses the single Component the folder ships,
so the folder-named file (`Menu/Menu.tsx`) is preferred. A named import
(`import { Step } from "./StepProgressBar"`) addresses one export of a
multi-Component barrel, so the file named after the export is preferred, then
the folder's `index` barrel to route the specific binding through. This
distinction is what lets `Step` and `StepProgressBar` — two Components in one
folder — resolve to their own files instead of collapsing onto the
folder-named one.

Dependency edges (`dependsOn`) resolve each imported binding through the same
mechanism. An edge is created only when a binding resolves to a Component's
declaring file — importing a hook, a style helper, or a type from a
Component's module no longer counts as depending on the Component.

## Considered Options

Resolving by file-name convention alone was the prior approach. It could not
follow re-exports, so a Component behind a nested barrel resolved to the
`index.ts` barrel itself — analyzed as the Component, yielding no tests, no
stories, no typing — and a named import of a multi-Component folder grabbed
the folder-named file, attributing one Component's source to another.

Following the chain into HOC wrappers — seeing through
`assignSubComponents(Inner, …)` to `Inner` — was considered, because a
folder's `index` barrel often default-exports such a wrapper. It was rejected
as unnecessary: the import-kind-aware rule resolves a default-imported folder
to its folder-named `.tsx` file directly, reaching the Component before the
wrapper `index.ts` is ever visited. Following arbitrary call arguments would
also be an unbounded heuristic — the wrapped value is not always the first
argument, nor always a component.

## Consequences

Resolution is best-effort past the root barrel: an unresolvable hop returns
the last real file reached rather than failing the Component, and a re-export
cycle stops at the file it loops back to. A folder that ships a Component
under a non-folder-named file with only an HOC `index.ts` and no clean
re-export would still resolve to that `index.ts` — accepted, as no such shape
appears in practice and the degradation is a single `unanalyzed` Component,
not a wrong attribution. `dependsOn` no longer over-reports folder-level
imports: this tightens it from "imports anything from the Component's folder"
to "imports the Component", matching the documented definition — an import
resolving to a Component's *source file*.

# The Dashboard is a prebuilt SPA, hydrated by data injection at build time

`cerebro build` never runs a bundler. The Dashboard app — a React SPA — is compiled by Vite once, at cerebro's own publish time, and shipped prebuilt inside the npm package; `cerebro build` runs a fresh Scan, copies the prebuilt assets to `.cerebro/dist/`, and injects the Scan result JSON into `index.html` (replacing an inline placeholder). This is the Storybook model (`storybook build` → `storybook-static/`, hostable anywhere): the user-facing contract is "produce the deployable static artifact", and the command is named `build` for that contract, not for its mechanism. React and Vite enter as devDependencies only; cerebro's runtime dependencies are unchanged, and `cerebro build` is near-instant on the user's machine. Routes are client-side hash routes (`#/components/<Name>`) and the data is inlined rather than fetched, so the artifact works opened from `file://` as well as hosted — a single self-contained directory with no server requirements.

## Considered options

- **Run Vite on the user's machine at `cerebro build`** — would allow per-project customization of the app itself, but drags React, Vite and their transitive graph into runtime dependencies, makes `build` slow, and couples it to the user's Node environment. Rejected: the Dashboard renders data, it does not compile user code, so nothing about the user's project needs bundling.
- **Render physical per-Component HTML files (SSG, no client runtime)** — smallest possible artifact, but every interactive affordance (sorting, filtering the Component table) must be hand-rolled in vanilla JS, and per-Component files reintroduce filename concerns (case-insensitive filesystems). Rejected in favor of one SPA with hash routes.
- **Fetch `scan.json` instead of inlining it** — cleaner separation on a server, but `fetch` is blocked on `file://`, which would silently break the open-the-file-directly flow. Rejected; injection keeps the artifact self-contained.

## Accepted consequence

The Dashboard UI is fixed at cerebro's publish time: a user cannot see dashboard improvements without upgrading cerebro, and the package ships the app's compiled assets to every user, CLI-only or not. Because `build` runs its own Scan, the rendered Dashboard always reflects the state `build` saw — the persisted `scan.json` cache is never read by `build` and stays a cache (ADR-0018).

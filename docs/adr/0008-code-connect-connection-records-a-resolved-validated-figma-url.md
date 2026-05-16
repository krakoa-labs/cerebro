# Code Connect connection records a resolved, validated Figma URL

Each Code Connect connection records the Figma URL of its target node so a consumer can link straight into Figma. The URL passed to `figma.connect()` may be a literal or a placeholder resolved through `documentUrlSubstitutions` in `figma.config.json`; Cerebro reimplements that substitution itself rather than storing the raw argument, so the recorded URL is directly usable and the consumer never needs the Figma config. The resolved string is then validated against a strict Figma node-URL shape — `figma.com` with a `/design/` or `/file/` path, a non-empty file key, and a non-empty `node-id` — and anything that fails (an unresolved placeholder, a non-literal argument, a flat URL pointing at no node) is recorded as `url: null` rather than as a string, turning a misconfigured connection into an explicit quality signal a consumer can derive a verdict from.

## Consequences

The validation pattern is coupled to Figma's current URL format: if Figma changes it, connections that are in fact valid would start reading as `url: null`. This fragility is accepted deliberately — a strict pattern is what makes `null` meaningful. A loose check would let flat, non-pointing URLs through as if they were usable links, and the quality signal would be lost.

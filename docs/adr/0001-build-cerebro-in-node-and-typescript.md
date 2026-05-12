# Build Cerebro in Node and TypeScript

Cerebro's centre of gravity is parsing TypeScript ASTs of React design systems, and the canonical tooling for that (the TypeScript compiler API, `ts-morph`, `ast-grep`) lives in the JS/TS ecosystem; building outside Node would mean either losing TS fidelity or depending on bindings (SWC, oxc) that don't cover the full language. We considered Rust and Go for runtime performance, but no profile from prior exploratory work indicated runtime cost as a bottleneck, so the speculative future-rewrite argument did not justify abandoning the AST ecosystem.

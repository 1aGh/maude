# scripts/v2-split — the V2-0.2 move-only split of `apps/studio/client/app.jsx`

Tooling for Maude v2 plan task V2-0.2 (`.ai/plans/feature-maude-v2-redesign.md`). The split
moves code verbatim; every tool refuses a move it cannot prove is behaviour-identical.

| Script | Does |
| --- | --- |
| `outline.mjs` | top-level statements of a module: kind, names, lines, referenced top-level names |
| `plan.mjs` | checks `modules.json` (module → declarations): acyclic module graph, nothing left needing app.jsx; prints the move order |
| `move.mjs` | `top` (declarations → module), `hook` (a contiguous run inside a component → `useX`, called in place), `render` (one JSX expression → `renderX`, called in place). TypeScript-checker scope resolution; refuses TDZ, let/var copies, cycles, JSX into `.js` |
| `run-top.mjs` | applies `modules.json` in dependency order |
| `app-outline.mjs` / `app-deps.mjs` | the statements inside `App()`, and which read a later `const` |
| `verify-verbatim.mjs` | independent proof: every base statement verbatim in exactly one file, nothing added, untouched files unchanged, `App()` equal to base after inlining the hooks back |

Verification per commit: `verify-verbatim.mjs --base <pre-split sha>`, then
`node scripts/check-v1-characterization.mjs --build --jobs 4 --boot-gate` (the V2-0.1 golden),
the 11 move-proof source tests, `scripts/check-import-coherence.sh`.

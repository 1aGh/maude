## Envelope discipline — don't over-prescribe

Generative skills (frontend-design, design-system) produce best work when given **constraints + intent**, not a shopping list. When the orchestrator builds the envelope:

✅ **DO:**
- Set the vibe ("studio-grade onboarding, light theme, breathable, editorial")
- Reference 1–2 existing canvases ("look at `<Mobile.tsx>` for the bezel pattern, `<Studio.tsx>` for grid")
- Point a full-screen surface at the platform showcase as its shell skeleton ("adopt the `ui_kits-desktop-showcase` chrome arrangement") — a single pointer, NOT a region-by-region transcription
- List 2–3 hard requirements (tokens link, body class, artboard count target)
- State the **aspiration directives 9–14 verbatim** — those are non-negotiable quality drivers
- Identify ONE signature moment intent per screen if the brief implies it ("welcome must have a memorable compositional anchor")
- Leave element-level decisions to the generator

❌ **DON'T:**
- Dictate "3 permission cards with location pin in orange and bell icon in blue"
- Pre-decide button counts, exact copy, padding values, specific component compositions
- List every UI primitive that should appear on each screen
- Translate the brief into a wireframe spec — the generator should do that

**Test:** if the envelope reads like a wireframe spec, it's too prescriptive. If it reads like a designer brief to a senior IC, it's right. A good envelope is ~30–50 lines including the boilerplate; an over-prescriptive one is 100+.

**Why this matters:** prescriptive envelopes lock the generator to *exactly what was dictated* — competent stock, no creative leap. The signature-moment-critic axis can't be hit if the envelope already pre-decided every element. Less prompting → more invention.

### Canvas-lib — single source of truth (ships with dev-server)

The frame primitives (`DesignCanvas`, `DCSection`, `DCArtboard`, `DCPostIt`) + specimen helpers (`SpecimenHeader`, `TokenChip`, `ColorSwatch`, `KbdHint`, `ThemeToggle`) + hooks (`useTokens`, `useTheme`, `useArtboardBounds`) all live in the dev-server-bundled canvas-lib at **`apps/studio/canvas-lib.tsx`** — single source, ships with the dev-server install (per DDR-025; no project-side copy is scaffolded).

Canvases import via the virtual specifier `@maude/canvas-lib`. The dev-server's `canvas-build.ts` plugin resolves that specifier to the bundled lib file before bundling. `/design:handoff` AST-inlines the used exports + their transitive deps into the emitted registry-item so the consumer drop is self-contained (zero `@maude/canvas-lib` references in the dropped TSX).

**One edit to `apps/studio/canvas-lib.tsx` reaches every open canvas** (HMR broadcast triggers a hard iframe reload). New canvases never need to copy frame primitives locally.

If you're authoring a new helper that should be shared across all canvases (e.g. a new `<DCPostIt>` variant or a token-introspection hook), add it to `apps/studio/canvas-lib.tsx` and `export` it. Sub-agents reading the lib's exports surface during `/design:edit` step 1.5 pick it up automatically.

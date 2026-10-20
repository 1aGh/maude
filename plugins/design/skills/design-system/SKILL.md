---
name: design-system
description: "Read a canvas design system, bootstrap a new system, or check its completeness. Select the matching mode."
user-invocable: true
---

# design-system — router

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

This skill has **two responsibilities** with **mode-switched flows**:

1. **READ flow** (default) — load the project's design-system context (tokens, philosophy, hard-stops, active families) so any agent iterating on a canvas respects the system.
2. **BOOTSTRAP flow** — scaffold a new design system (first one, an additional one alongside an existing DS, or re-bootstrap an existing DS with `--force`).

The mode is **auto-detected** at invocation (see `## Mode-detection` below). **This router is intentionally small — load exactly one sub-doc for the resolved mode so a turn never parses the flow it doesn't need.**

- **READ** → load [`_read.md`](./_read.md) only.
- **BOOTSTRAP** → load [`_bootstrap.md`](./_bootstrap.md) only (it carries discovery, the **Stage-3 direction gate** (pre-refinement moodboard pick of ~`moodboard.variants` seed-composed directions — DDR-080 + DDR-147) + the **Stage-4 refinement residue** + the **LOCK gate** (the direction contract) + the **Batch-A hero-preview drift gate**, scaffold, the opt-in organic-artifact seed step (`draw-agent` — backgrounds / patterns / spot / brand mark, grounded in the discovered palette), the 4-round post-scaffold gate, and Post-Flight). Discovery probes load on demand from [`_pastier-probe-templates.md`](./_pastier-probe-templates.md) when you reach Stage 2.

The **Animation tooling contract** below stays in this router because both flows share it and `commands/new.md` + `commands/edit.md` link to "SKILL.md → Animation tooling contract".

---

## Mode-detection (which flow to run)

At every invocation, decide which flow to execute:

- Invoked via `/design:setup-ds <name>` → **BOOTSTRAP**, `target_ds = <name>`
- Invoked via `/design:edit "..."` or `/design:new "..."` AND no `<designRoot>/system/*/` exists → **BOOTSTRAP**, `target_ds = "project"`, Q1 prefilled from `$ARGUMENTS` / `$BRIEF`
- Invoked via `/design:setup-ds <existing-name> --force` → **BOOTSTRAP** (re-bootstrap), `target_ds = <existing-name>`
- Invoked via `/design:setup-ds <name> --app` (the Maude app's "Make a design system" sheet) → **BOOTSTRAP**, sub-mode `app`, `target_ds = <name>`; the brief is the person's sentence, verbatim
- Invoked via `/design:setup-ds <name> --upgrade-schema` (the Maude app's "Bring <system> up to the schema?" sheet, or by hand) → **UPGRADE**, `target_ds = <name>`: load nothing else — [§ upgrade-schema](#upgrade-schema) below is the whole flow
- Otherwise (active canvas exists, `system/*/` exists) → **READ** (default)

When in BOOTSTRAP mode, classify into sub-modes:

- `first-bootstrap` — `.design/config.json` does not exist (or `designSystems[]` is empty)
- `additional-ds` — config exists, `target_ds` is NOT in `designSystems[]`
- `re-bootstrap` — config exists, `target_ds` IS in `designSystems[]`, `--force` passed (else refuse)
- `app` — `--app`: the Maude app already made the system as an outline (`revisions/head.json` has no head). The flow is `_bootstrap.md` § "`app` adaptation": three directions written with `maude design ds draft`, the in-app pick as the gate, the sections filled through the working files, and no `ds done` (the person's button does it)

If both modes seem plausible, **prefer READ** — bootstrap should be the explicit choice.

Once the mode is resolved, **load the matching sub-doc** ([`_read.md`](./_read.md) or [`_bootstrap.md`](./_bootstrap.md)) and follow it. The sub-mode adaptations (`additional-ds`, `re-bootstrap`) are documented inside `_bootstrap.md`.

---

## upgrade-schema

Bring a design system that was made before the schema (ds-check level 11, or 10 with more than `missing-functional` wrong) up to the schema (V2-1.13 §5.10), **without changing how any canvas looks**. Invoked as `/design:setup-ds <ds> --upgrade-schema`; in the Maude app, the amber dot on the system's row (or a switch to or from it) opens "Bring <system> up to the schema?" and its "✦ Bring it up" sends you here with that message. **The person applies; you never do.** Everything goes through `maude design ds-upgrade <ds> …` — nothing in `system/<ds>/` or `config.json` is edited by hand, and a system that already lives on a Design system canvas (`revisions/head.json` exists) is refused with `ds-upgrade-converted`: say so plainly and stop.

**The steps, in order**

1. `maude design ds-upgrade analyse <ds>` — the deterministic first pass. It returns the mechanical plan: the `.ds` scope selector, alias inversions (`--w-semibold` → `--weight-semibold`), own-token prefixes (`--island-bg` → `--x-island-bg`), the manifests, and one `add-role` item per functional role the system lacks, each `status: needs-judgement`.
2. **Judge what is left open** — only the `needs-judgement` and `needs-pick` items, from the system's own colours and type (read `colors_and_type.css`, its `README`, its specimens). Write them to a JSON file as a list of plan items with the same `id`s:
   - an `add-role` item becomes `{ "id": "role:--scrim", "kind": "add-role", "status": "judged", "by": "ai", "values": { "light": "<value>", "dark": "<value>" }, "sources": ["--fg-0", "--bg-0"], "note": "<why>" }` (`"*"` for a value that does not change by theme). **A new colour is built only from the system's own tokens** — `var(--x)`, `color-mix(in oklch, var(--a) 40%, transparent)`, relative colour over them. Never a literal hex or `oklch(0.6 …)` (V3).
   - a colour kind the system lacks entirely (no brand, no chart palette) is the one place a new hue is allowed: `status: "needs-pick"`, `newHue: true`, **exactly three** `options`, and a `picked` index — the person picks in the chat first; never pick for them (V4).
   - a collision (`--x` already declared) is resolved as old meaning → new name, and written down in the item's `note` (V1).
   - Do not add items of your own for canvases: the codemods are made at stage time.
3. `maude design ds-upgrade validate <ds> <judged.json>` — refuses a breach of V1–V4 and V8 with exit 13 and names the item. Fix the item; do not loosen the check.
4. `maude design ds-upgrade <ds> --stage <judged.json>` — copies `.design/` to a throwaway `before/` and `after/` outside the project, applies the plan to `after/`, and writes the canvas codemods (only `var()` names, `className` tokens, import lines and meta keys change — V6). Canvases left out at an older revision, `pinned` canvases and `ui/v2/**` get no codemod (V7, Q2). The live tree is untouched. It prints the stage's **stamp**.
5. `maude design ds-upgrade <ds> --prove <stamp>` — two quiet studios render every artboard of every affected canvas and specimen, in every theme, and diff them (a pixel counts when its OKLab ΔE × 100 is over 2; an artboard fails over 0.5 % changed pixels). It takes about a second per artboard and theme; the app shows its progress and a Cancel. A canvas whose codemod fails is **refused** (it stays as it is, and the person sees "N canvases can't be updated yet"). A failure on a canvas with **no** codemod — or on a specimen — is the system files' fault, and refuses the whole apply (`systemFailed`): system edits must be invisible, because the new roles have no users yet. If that happens, find the item that shows (usually a role whose value is not what an existing literal looked like), fix the judged item, `--discard` the stage and start again from step 3.
6. **Stop.** Tell the person in one short message what the stage does (the numbers in `review.json`: roles added, components renamed, own tokens kept, canvases updated, canvases refused) and that the sheet is ready. **Do not run `--apply`.** In the app the sheet's primary button is the apply (one action, one undo step, the permission card on the agent side); in Claude Code the person asks you, and the card appears.

**What the engine does and does not do.** It applies the scope selector, alias inversions, own prefixes, `add-role` items, the manifests and the canvas codemods. A `map-component` item (`{ "id": "component:island", "kind": "map-component", "native": "island", "to": "Panel", "variant": "floating" }`) is recorded and shown as "Renames N components", but the engine does not rewrite component CSS: keep the old class as a second selector yourself (`.island, .panel--floating { … }`, V5) in `preview/_components.css` before you stage, so both copies carry it.

**Housekeeping.** `maude design ds-upgrade <ds> --status` lists the system's live stages (staged, being proved with `current`/`total`, proved with its review); `--cancel <stamp>` stops a proof in flight; `--discard <stamp>` removes a stage's copies and record. A stage whose project has moved since it was made (`ds-upgrade-stale`) cannot be applied: discard it and stage again. Never run the steps for another project, never implicitly (boot, sync and `maude migrate v2` never start a bring-up).

---

## Animation tooling contract (authoritative — DDR-049)

**This is the single source of truth for how animation is authored in Maude.**
It applies identically to **specimens** (`system/<ds>/preview/*.tsx`) and
**canvases** (`ui/*.tsx`). When `/design:new`, `/design:edit`, `/design:setup-ds`,
or any critic touches motion, this section wins over any looser phrasing
elsewhere. Other docs (`commands/new.md`, `templates/.../SUB-AGENT-PROMPTS.md`,
`agents/motion-critic.md`, `agents/design-system-keeper.md`) link here rather
than restating the rule.

**Default — Motion One via canvas-lib (MUST).** Any animated UI MUST use the
canvas-lib motion vocabulary from `@maude/canvas-lib`, which wraps Motion One
(`motion/react`):
- `<MotionDemo role>` — the 8 canonical roles: `flip` · `panel` · `route` ·
  `soft` · `spring` · `scroll` · `drag` · `presence`. Each binds a `--dur-*` +
  `--ease-*` token pair, clips its own bounds (`overflow:hidden`), and defaults
  to `loop="always"` so motion is visible on first paint (closes the
  "looks dead until you hover/replay" failure mode).
- `<MotionTrack>` (staggered rows), `<TokenPlayback>` (replay chip),
  `<ReducedMotionToggle>` (in-browser reduced-motion preview), `useMotionTokens()`,
  `easingFromToken()`.
- `motion/react` is declared as a peer dep of canvas-lib and emitted into
  `/design:handoff`'s `registry-item.json` automatically — handed-off canvases
  animate in a Next.js + shadcn target with no manual `npm i`.

**Escape hatch — pure-CSS `.motion-*` classes (opt-in, must be justified).**
Zero-JS surfaces may use the role classes shipped in `_components.css`
(`.motion-flip … .motion-presence`) — same token bindings, same bounded
keyframes, no JS. Legitimate ONLY for declared zero-runtime cases: static hero,
a single hover/focus transition, an accessibility-first marketing page. Choosing
the escape hatch over `<MotionDemo>` MUST be recorded with a one-line reason
(canvas `.meta.json` note, or the DS bypass log for a specimen).

**Never:**
- Hand-roll `@keyframes` for any of the 8 roles when a `<MotionDemo role>` /
  `.motion-*` equivalent exists. (`motion-critic` + `design-system-keeper`
  enforce this — warning in ordinary canvases, **blocker in the `motion.tsx`
  specimen**, which is the teaching artifact and must model the canonical path.)
- Add `!important` reduced-motion overrides anywhere except the motion
  specimen's `<ReducedMotionToggle>` chrome. Tokens already collapse `--dur-*`
  to `1ms` under `@media (prefers-reduced-motion: reduce)`; with `motion/react`
  use `useReducedMotion()` and short-circuit the `animate` prop.

**Decision rule when generating:** brief implies motion (`animate`, `transition`,
`play`, `loop`, `slide`, `fade`, drag/drop, route transitions, presence cursors,
scroll-linked) → reach for `<MotionDemo role>` first; drop to `.motion-*` only
for a justified zero-JS surface; never reinvent keyframes for a named role.

---

## Companion skills

- `design` — user-facing orchestrator (canvas-first iteration loop)
- `ui-kit` — pointer to project-specific reference surfaces / components
- `frontend-design` (external plugin) — generates new canvas files using these tokens

## Cross-links

- READ flow: [`_read.md`](./_read.md)
- BOOTSTRAP flow: [`_bootstrap.md`](./_bootstrap.md)
- Discovery probes: [`_pastier-probe-templates.md`](./_pastier-probe-templates.md)
- Inspiration library: `plugins/design/templates/design-system-inspiration/`
- Mapping contract: `plugins/design/templates/design-system-inspiration/_MAPPING.md`
- Tokens (authoritative, post-scaffold): `<designRoot>/<tokensCssRel>` (single-DS) or `<designRoot>/system/<ds>/colors_and_type.css` (multi-DS)
- Live specimen browse: dev server at `http://localhost:<port>/<designRoot>/system/...`
- Per-repo config: `.design/config.json`
- Completeness-critic: `plugins/design/agents/design-system-completeness-critic.md`
- Stage-2 research agent: `plugins/design/agents/ux-research-agent.md` (mode `discovery`)
- Stage-2 payload cache: `<designRoot>/_history/_system/<ds>-<brief-sha8>-domain-research-discovery.json` (brief-hash in key — different briefs in same DS get separate cache files)

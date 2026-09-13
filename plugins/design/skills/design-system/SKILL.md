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
- Otherwise (active canvas exists, `system/*/` exists) → **READ** (default)

When in BOOTSTRAP mode, classify into sub-modes:

- `first-bootstrap` — `.design/config.json` does not exist (or `designSystems[]` is empty)
- `additional-ds` — config exists, `target_ds` is NOT in `designSystems[]`
- `re-bootstrap` — config exists, `target_ds` IS in `designSystems[]`, `--force` passed (else refuse)

If both modes seem plausible, **prefer READ** — bootstrap should be the explicit choice.

Once the mode is resolved, **load the matching sub-doc** ([`_read.md`](./_read.md) or [`_bootstrap.md`](./_bootstrap.md)) and follow it. The sub-mode adaptations (`additional-ds`, `re-bootstrap`) are documented inside `_bootstrap.md`.

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

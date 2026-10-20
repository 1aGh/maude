# Design plugin — command categories

> Canonical catalog of slash-command groups for the `design` plugin. The live index is rendered by `/design:help` from each command file's `category:` frontmatter field. This file is the **prose explainer** (why each group exists, naming convention, rename history); the frontmatter is the source of truth for the list.

## Why categorization

Claude Code's slash-command UI doesn't support subdirectory namespacing (issue [#2422](https://github.com/anthropics/claude-code/issues/2422), closed not-planned; [#44678](https://github.com/anthropics/claude-code/issues/44678) is the open feature request). Two working substitutes:

1. **Plugin namespace added by Claude Code itself at registration** — every command's `name:` field is the bare slug (`edit`, not `design:edit`); Claude Code prepends `design:` automatically (per [DDR-191](../../.ai/archive/decisions/DDR-191-revert-plugin-name-prefix-claude-code-now-namespaces.md), which supersedes the older [DDR-006](../../.ai/archive/decisions/DDR-006-plugin-namespace-in-name-frontmatter.md) — that DDR had us bake the prefix in by hand as a workaround for a since-fixed Claude Code bug; doing so today stutters the namespace twice in autocomplete).
2. **Strict `<group>-<verb>` filename prefix** — typing `/design:setup-` autocompletes only the `setup-*` members.

Mirrors the flow plugin's pattern (`plugins/flow/CATEGORIES.md`).

## Groups

### daily — Verb-as-complete-action, called every iteration cycle

Default verbs. No prefix. Members:

| Command | Description |
|---|---|
| `/design:edit` | Iterate on the active canvas with auto-critic loop |
| `/design:new` | Scaffold a new multi-artboard canvas project (or, with `--blank`, an annotation-only **brief board**; ingests a board's notes when run on an annotated brief-board) |
| `/design:draw` | Generate a verified SVG mark (logo / icon / illustration / diagram / spot) via the geometry engine + visual self-verify loop |
| `/design:generate` | Generate an image, a sound or a video clip from your own AI provider key (BYOK) and land it on the canvas, marked Made by AI — the key stays with Maude, skill `ai-generation` |
| `/design:photo` | Edit a photo headlessly, for every use of it — adjustments / duotone / grain / pattern / mask (parametric, no browser) + background removal on this Mac, via the non-destructive PhotoEdit sidecar; one use only is a per-use edit |
| `/design:critic` | Spawn the critic panel (or single agent / all critics) |
| `/design:browse` | Boot the local dev server |
| `/design:rollback` | Go back to an earlier version of the canvas (built on Version history; no flag undoes the last change) |
| `/design:history` | Version history from the terminal: list, show, diff, restore (whole canvas, one artboard or one object), name a version |
| `/design:trash` | See the Trash and restore a canvas or artboard (clearing it out is the owner's, at a terminal) |
| `/design:comments` | Make the changes the open comments ask for, then reply and resolve each thread |
| `/design:present` | Set Present order, skipped artboards and speaker notes; open the canvas in Present |
| `/design:open` | Show a canvas, artboard, element or panel in the Maude window |
| `/design:assets` | List the project's assets, where each is used and which are not; with `describe`, search in pictures (only after the person said yes) |
| `/design:screenshot` | Capture a screenshot of the active canvas (`--full`/`--screen <id>`/`--element <id>`/`--all-screens`/`--selector <css>`) |
| `/design:handoff` | Hand the active canvas off to production: a shadcn registry item (the web target); the other targets are drafted by AI from Handoff to production |
| `/design:to-lottie` | Productionize a maude animation → ONE `.lottie` from code (web + mobile, 1:1; emitter, not converter) |
| `/design:to-rn` | FALLBACK — native react-native-svg + Reanimated component from the IR (light animation only) |
| `/design:board` | Read the whiteboard with artboard + ELEMENT context, and/or author a whole tidy template (retro / kanban / social calendar / roadmap / brainstorm / checklist / user-flow) onto it — skill `whiteboard` |
| `/design:reel` | From a folder of raw clips (or the active canvas's clips) to a directed, graphics-laden video cut in one prompt — ingest → SHARED analysis step (same as `/design:video-analyze`: smart-frames → optional transcribe → Read-only footage-analyst → orchestrator persists) → footage-director (EDL) → `<TransitionSeries>` codegen → critics; skills `footage-keyframes` + `footage-director` + `video-comp` |
| `/design:video-analyze` | Analyze ONE clip (or folder / active canvas) end to end — picture AND sound — in one prompt: scene-aware keyframes (skill `footage-keyframes`) + `transcribe` → footage-analyst → FootageAnalysis sidecar (incl. `speech`) + human report. Analysis-only (vs `/design:reel`, which cuts) |
| `/design:import` | Bring an existing design into Maude. `--reconstruct <image>` (experimental) turns a Figma-frame PNG into a token-styled canvas via a Bash-free vision-authoring + reality-check loop — see [DDR-174](../../.ai/archive/decisions/DDR-174-vision-reconstruction-trust-boundary-and-experimental-posture.md). Token/brand ingestion have their own dedicated entry points (`maude design import-tokens`, `/design:setup-ds --from-brand`), not this command. |
| `/design:help` | Print this grouped index |

The bare `/design` form was a one-version compat stub in v0.8 that redirected to `/design:edit`. **Removed in v0.9** — only `/design:edit` resolves now.

**Brief boards (Phase 22).** `/design:new` has three modes (resolved internally, not separate verbs — see [DDR-085](../../.ai/archive/decisions/DDR-085-canvas-kind-and-design-new-ingest-mode.md)): **normal** (generate a new canvas), **blank** (`--blank` → an annotation-only `kind:"brief-board"` canvas, zero model cost), and **ingest** (run on an annotated brief-board → read its sticky/text notes verbatim and insert generated artboards into the same canvas). Escape hatches: `--from-annotations` (force ingest anywhere) / `--fresh` (ignore a board's notes, scaffold a new file). We deliberately overloaded `/design:new` rather than adding a `/design:brief-board` verb — the user creates and fills a board through the same command.

**Whiteboard AI toolkit (feature-whiteboard-ai-toolkit).** `/design:board` is a NEW verb, not an overload of `/design:edit`/`/design:new` — the read→understand→author→verify loop over the FigJam draw layer is a distinct workflow from component editing, and the user explicitly asked for the full two-way toolkit (see [DDR-151](../../.ai/archive/decisions/DDR-151-whiteboard-ai-toolkit-geometry-manifest-and-element-context.md)). The low-level verbs (`maude design canvas-rects`/`read-annotations`/`annotate`) and the full read/write/template spec live in skill `whiteboard`, not in this command's own body.

### setup — One-shot bootstrapping operations

Members:

| Command | Description |
|---|---|
| `/design:init` | Initialize the project environment (deps check, install hints, skeleton `.design/config.json`). Mirrors `/flow:init`. |
| `/design:setup-ds` | Create a design system (first one, additional, or re-bootstrap with `--force`). Thin wrapper → skill `design-system` in bootstrap mode. |
| `/design:setup-docs` | Refresh `.design/README.md` + `INDEX.md`. Auto-runs after `/design:edit` and `/design:new`; manual trigger to force a refresh. |

Why three setup verbs:

- **`init`** is project-level — runs **once** per repo to prepare the ground (dependency hints, CLAUDE.md / .ai/ recommendations, skeleton config). Auto-invoked when other commands hit a missing `.design/config.json`. Bare-verb filename is an exception to the `<group>-<verb>` rule — it mirrors Claude Code's built-in `/init`.
- **`setup-ds`** is per-DS — runs **once per design system** (first one for a project, or every time you add a marketing-vs-admin-vs-mobile DS). Auto-invokes `init` first if config is missing.
- **`setup-docs`** is per-canvas-event — auto-runs after every `/design:edit` and `/design:new`. Manual trigger when you want to force a regeneration.

### hub — Self-hosted infrastructure

Members:

| Command | Description |
|---|---|
| `/design:hub-workspace` | Stand up a self-hosted **workspace** (a hub that owns the project, commits autosaves, and stores media in object storage) and verify it before saying it works. Conversational wrapper over `maude hub workspace-up`. |

Why its own group rather than `setup`: `setup-*` prepares a repo on the machine you are sitting at. A `hub-*` verb provisions **infrastructure other people will depend on**, with secrets, DNS, and an operator who is on the hook afterwards. Grouping the two would put "refresh my README" one autocomplete away from "provision a server", and the blast radius is not comparable.

## Auto-routed audit agents (NOT user-invocable)

Some files under `plugins/design/agents/` are read-only audit agents auto-routed by the orchestrator — they are **not** user-invocable slash commands and do **not** appear in `/design:help`. Their frontmatter intentionally omits `category:` so they stay out of the catalog. Documented here for discoverability:

| Agent | Routed by | What it audits |
|---|---|---|
| `design-system-keeper` | `/design:new` step 9.5 (always) + `/design:edit` step 7.5 (when diff ≥ 10 lines or new class root) + `/design:edit` step 8a (DS-drift fast-path) | DS fidelity to priors — pattern reinvention scan + token-usage audit against the DS README's `## Token usage guide` section. Read-only; warnings unless ≥ 5 token mismatches OR ≥ 3 pattern reinventions stack. Skip with `--skip-ds-keeper`. See [DDR-010](../../.ai/archive/decisions/DDR-010-design-system-keeper-agent.md). |
| `design-system-completeness-critic` | `skill design-system` bootstrap end + `/design:critic --system-only` | Structural completeness of the DS itself (3-tier rule set: Core blockers / Conventional warnings / Free-form acknowledged). Per-DS in multi-DS projects. |
| `draw-agent` | `/design:draw` + `/design:new` (art slot) + `/design:edit` (draw/add logo·icon·illustration·diagram feedback) + `/design:setup-ds` (opt-in organic seed artifacts — backgrounds / patterns / spot / brand mark) | **Generator** (not an audit agent): produces a verified SVG mark via the geometry engine + plan→generate→pairwise-rank→keep-best→rubric loop. Emits the standard JSON verdict. See [DDR-070](../../.ai/archive/decisions/DDR-070-svg-generation-geometry-engine.md). |
| `draw-critic` | `/design:draw` (default) + `/design:critic` panel (when the canvas has a custom logo/icon/illustration/diagram) | Independent rubric judge for standalone vector art (the gap `graphic-design-critic` doesn't cover). Scores against `references/draw/design-rules.md`. |
| `reconstruct-agent` | `/design:import --reconstruct` only | Vision-reconstruction authoring agent (DDR-174). Deliberately `tools: Read, Write, Glob, Grep` — no `Bash`/`WebSearch`/`WebFetch`, because it reads an untrusted source image. Never spawned by the critic panel or any other command. |
| `reconstruct-critic` | `/design:import --reconstruct` only | Bash-free reality-check comparator (DDR-174) — a SEPARATE agent from `design-critic`, same restricted toolset as `reconstruct-agent`, because it also reads the untrusted source image (to judge fidelity). Emits a strict typed `converged` verdict; never routed as a general critic-panel member. |
| `asset-describer` | The studio's describe service + `maude design describe` (search in pictures, after the person's consent) — headless, never auto-delegated | Says what each picture in a batch shows (caption, tags, visible words) as `maude.agent-handoff/1`. `tools: Read` only; its cwd is an OS temp dir of downscaled tiles, never a project path; its answer is validated before a word is kept (V2-1.17 §5.9, S12.13) |

Both `design-system-*` agents declare bare `name:` frontmatter (`design-system-keeper`, `design-system-completeness-critic`) — Claude Code namespaces them to `design:design-system-keeper` / `design:design-system-completeness-critic` itself at registration (per [DDR-191](../../.ai/archive/decisions/DDR-191-revert-plugin-name-prefix-claude-code-now-namespaces.md); baking the prefix into `name:` by hand, per the superseded [DDR-006](../../.ai/archive/decisions/DDR-006-plugin-namespace-in-name-frontmatter.md), would double it). `draw-agent` and `draw-critic` follow the same convention (bare `name:`, resolving to `design:draw-agent` / `design:draw-critic`) — they're auto-routed / panel agents, not user-invocable slash commands, so they omit `category:` and stay out of `/design:help`. Wherever these agents are *spawned* (`subagent_type:` in a command or skill), the single-prefixed form (`design:draw-agent`, …) is required — the bare `name:` field and the prefixed `subagent_type:` caller value are not the same string, by design.

## Naming convention

Commands within a group prefix the group name with a dash separator:

```
/design:setup-ds               ← group "setup", verb "ds"
/design:setup-docs             ← group "setup", verb "docs"
```

Exception: `/design:init` is a bare verb (no `setup-` prefix) because it mirrors Claude Code's built-in `/init` and is the recognized bootstrap entry point.

Daily commands have no prefix:

```
/design:edit                   ← daily
/design:new                    ← daily
```

This makes autocomplete predictable — typing `/design:setup-` shows only the three setup verbs.

## Rename history

| Old | New | When | Why |
|---|---|---|---|
| `/design` | `/design:edit` | v0.8 | Verb-as-action; resolves naming collision with skill `design` |
| `/design:docs` | `/design:setup-docs` | v0.8 | Categorization to `setup-*` group |
| `/design` (compat stub) | removed | v0.9 | One-version compat retired per the v0.8 contract |
| `/design:setup-onboard` | `/design:init` | post-v0.9 | Bare-verb alias mirroring Claude Code's built-in `/init`; namespaced via `name: design:init` frontmatter |
| `/design:screenshot` flags expanded | `--full` only → `+ --screen/--element/--all-screens/--selector` | Phase 13 | Stable element IDs (`data-dc-screen`/`data-dc-element`) plus canonical helper `dev-server/bin/screenshot.sh` (agent-browser primary, playwright fallback). Inline `agent-browser navigate + screenshot` bash blocks removed across commands/agents/skills. |

## Adding a new command

1. Pick the group from the table above. If none fits, propose a new group in this file (with prose justification) before adding the file.
2. Create `plugins/design/commands/<group>-<verb>.md` (or `<verb>.md` for `daily`).
3. Set frontmatter: `name: design:<verb-or-group-verb>` (e.g. `design:setup-foo`), `category: <group>`, `description: <one-liner>`, `argument-hint: <if any>`.
4. `/design:help` picks it up automatically — no manual catalog update needed.
5. Add an entry to the relevant section of this file if the group prose needs explanation.

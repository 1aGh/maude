---
name: feature-maude-v2-redesign
status: Phase 0 ready; Gate 0 signed except A13 (files-are-the-API, waiting for Michal's confirmation)
created: 2026-10-08
supersedes:
  - feature-desktop-project-tabs-and-identity-profiles (absorbed as Phase 3; full Rust spec kept at .ai/plans/archive/feature-desktop-project-tabs-and-identity-profiles.md)
  - feature-post-1.0-hardening-backlog — items T3, T6, T7–T10, T13 (minimum), T17, T21′, T23 (absorbed; the rest of that backlog stays open there)
decisions:
  - One plan implements every feature drawn in .design/ui/v2/ (16 canvases, ~380 artboards) for Maude v2.0.0 — desktop app, studio client, server, hub/cloud and docs.
  - Project tabs = variant A, native macOS window tabs (Michal, 2026-10-08). Tab avatars and tab status glyphs drawn in 01/02/kit are NOT built; that state lives in the project pill and the Share cluster.
  - Cloud scope is fully in (Michal, 2026-10-08): cloud.maude.sh sign-in/invite/account pages, hub roles (Can view · Can comment · Can edit · Owner), per-canvas sharing, owner-only clear-out, mention e-mails, design-system team libraries, trial.
  - Every "Proposed" rule is decided in the Gate 0 register BEFORE the run (Michal, 2026-10-08). The run never starts Phase 1 with an unsigned row.
  - Nothing is deleted. Every existing tool, action and debug surface stays reachable (menu, ⌘K, a panel's Advanced fold, Diagnostics, Settings). Merging duplicates (two export dialogs, two Share meanings) is allowed; losing a capability is not. Deleting legacy CODE (old chrome, old token layers) after its capability is rehomed is required, not forbidden.
  - Delivery (Michal, 2026-10-08): **Phase 0 splits `app.jsx` into modules on `main` (move-only, pushed)**; everything after it is committed task by task to **one branch `feat/maude-v2`**, Michal tests it, and it lands as **one PR** into `main`. Only Michal commits to `main`, so the branch does not drift. The plan debate's concern (a long branch vs a 17k-line file other sessions keep editing) is answered by doing the split first on `main`. There is no v1/v2 switch (Michal, 2026-10-08): the branch rewrites the old UI in place — v1 is compared via a `main` build and protected by the frozen v1 reachability manifest + characterization tests; any `v2.0.0-rc` tag happens after the PR merges, only through the prerelease channel built in Phase 2.
  - Maude is a design tool built around AI (Michal, 2026-10-08): what is on the surface matches what is under it. Claude drives every v2 capability the way it does today — skills + direct edits of the readable JSX/JSON files in `.design/` — with the `maude` CLI for what is not a file edit (render, generation, sync, history/trash, opening things in the window, checks). No MCP layer. Every registry action records how Claude does it (file format / CLI verb / human-only); the design/flow plugins, skills, agents, hooks and CLI evolve in the same change as the feature (S12 + every package's done-when).
  - Design systems follow a three-tier Maude schema (Michal, 2026-10-08): required core roles that swap mechanically, expressive slots paired by kind, and a system's own tokens/components (unlimited, handed to AI on a switch). Users never map tokens (Advanced only); systems made before the schema are brought up by AI once. Supersedes C1's "files keep their own names".
  - "Done" is a script, not a judgement: `scripts/v2-done.sh` exits 0 only when the coverage ledger has zero open ids and every gate is green.
---

# Feature: Maude v2.0.0 — the redesign, implemented end to end

> **Start the session:** in Claude desktop (Code tab) open the `maude` project on `main`, pick **Opus 5.5** in the model picker, and send `/goal` with the text below. No env vars to set by hand — the repo's `.claude/settings.json` already carries `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` and `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=50` (added 2026-10-08). First actions: write the run marker `.ai/state/v2-run.json` (`{ "sessionId": <this session's id>, "started": <iso> }`), verify the task tools exist, load the current phase into the native task list, run `kg search "maude v2"`.
>
> **Goal for the `/goal` session (paste this):** Implement `.ai/plans/feature-maude-v2-redesign.md` completely, as an agent team per "How this plan runs". The goal is met only when the transcript shows `bash scripts/v2-done.sh` run and exiting 0 (coverage ledger: zero open artboard ids; nothing-deleted audit 100 %; every Phase 8 gate green; a packaged `.app` built from `feat/maude-v2` verified and the PR description ready for Michal). Work happens on `feat/maude-v2` (Phase 0 is the only work on `main`). Resume from the Progress log + `git log`, never from memory. Never skip a gate; never delete a feature; never invent a design the canvases don't show — when the canvases are silent, follow the Gate 0 register, then CONTRACT.md, then the topic-owning canvas; log the call in the Progress log and pick the most conservative option. Stop and report (do not improvise) on an owner-run step (G0-E).

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports. The canvases are the spec; this file is the route through them.

## Description

Maude today "looks like a nuclear power plant control room": six in-app menus, a status bar, docked panels, a 13-tool palette, a 7-tab Settings, git vocabulary and ports in the chrome. v2 rebuilds the desktop/studio UI for designers (Figma / Framer / Notion feel): native project tabs + Home, a project pill with **one menu**, floating panels that fold into an icon, two toolbars (Edit makes things inside artboards; Preview annotates), a Share cluster with the mode switch, ⌘K Search that finds every hidden tool, Advanced as a fold at the foot of each panel, and status shown in words. Cloud (cloud.maude.sh) is the default path; local projects, self-hosted hubs, CLI and git are Advanced.

The full design already exists and was critic-reviewed:

- **Design system:** `.design/system/maude-v2/` — tokens `colors_and_type.css`, components `preview/_components.css`, specimens `preview/*.tsx`, and **`CONTRACT.md`** (menu tree §1, keys §2, words §3, voice §4, type roles §5, settled details §6, cross-canvas rules §7).
- **Canvases:** `.design/ui/v2/00 Index … 15 Annotations` + shared kit `_kit.tsx`/`_kit.css` and `_video.tsx`.
- **Implementation inventories** (extracted from every artboard, verbatim copy, edge cases, backend needs, contradictions): `.ai/plans/notes/v2-inventory/A…F`. They are the completeness checklist for this plan.

## User Story

As a designer (Michal, Tereza, Jonas — and someone who has never opened a terminal), I want Maude to open on my team's projects in cloud.maude.sh, let me find any canvas, make and edit things on artboards, ask AI in plain words while several AI sessions run, preview / present / annotate / share / export without learning developer concepts, so that Maude feels like Figma with an AI that does the work — while every power tool Maude has today is still one fold away.

## Problem

- The client is one 17,444-line `app.jsx` (`App()` ≈ 7.4k lines, 160 `useState`, no context, ~15 separate keydown listeners, no shortcut registry); Biome skips `client/`; three token generations coexist (`--u-*`, old `maude`, soon `maude-v2`).
- The canvas iframe owns its own chrome (tool palette, mode toggle, HUD) with hard-coded old-maude colours (`canvas-shell.tsx` `HUD_TOKENS_CSS`).
- The desktop is one window, one identity; the project-tabs plan was written but never executed.
- ~30 user-visible features exist today that no canvas explicitly homes (see Nothing-deleted contract §B) — the easiest way to break the "nothing deleted" rule.
- Many v2 features do not exist at all (≈ 60 % of artboards draw NEW behaviour: per-artboard AI, presenter view, links between artboards, DS-as-canvas with review, captions/beat/linked formats, Can view role, per-canvas sharing, semantic version diff…).

## Solution

Five moves, in order:

1. **Decide before building** — Gate 0 register (Michal signs), folded into CONTRACT.md + one DDR, then architecture spikes recorded as DDRs (Phase 1).
2. **Make the codebase able to take a reshell without breaking** — first `app.jsx` split into modules with characterization tests, on `main` (Phase 0); then on the branch: prerelease channel + release-trigger gating, frozen v1 reachability manifest, Biome on client, one action/shortcut registry, typed shell↔canvas bridge, route modules, state stores, prefs migration, token pipeline (Phase 2). The app looks unchanged after both.
3. **Native tabs + identity + Home** (Phase 3) and **the v2 shell** replacing the old chrome in every shell — desktop, browser, cloud tab, viewer, embed (Phase 4), with e2e, tours and spotlights moved in the same phase.
4. **Feature work packages S1–S11** run on four lanes with one integrator (Phases 5–6); the canvas-iframe lane is serial because its files are shared.
5. **Docs + verification + cleanup + PR** (Phases 7–8): fidelity evidence per artboard, 100 % nothing-deleted audit, leftover v1 code and token layers deleted, a packaged `.app` from the branch for Michal's test, then one PR into `main`; an `rc` release only after the merge.

**Surface = substrate.** Every capability is a registry action with a server route and a recorded AI path — a documented file format Claude edits, a `maude` verb, or human-only — so a feature isn't done when its pixels are; it is done when Claude can drive it too, its data survives v1↔v2 peers, its permissions hold on the server, and its runtime state is classified.

Build on what exists — the cheapest viable path per work package is listed in its "Reuse" column. Inventing parallel copies of the session, version, undo or role systems is the main scope risk (SHIPPER).

## Metadata

- **Ticket**: none (provider `github`; open an epic issue at Phase 8 if Michal wants one)
- **Type**: New Capability (product redesign, major version)
- **Complexity**: High — program-sized
- **App/Package**: `apps/studio` (client, server, canvas-lib, canvas-shell, exporters, sync), `apps/desktop` (Tauri shell, e2e), `apps/hub`, `apps/cloud` + `apps/cells` (cloud web pages, roles, e-mail), `apps/render`, `cli/`, `plugins/design` (verbs the UI calls), `site/` (docs + maude.sh), `.design/system/maude-v2`
- **Affected Systems**: everything user-facing; sync/hub roles; ACP runtime; export pipeline; release pipeline (prerelease channel)
- **Dependencies**: no new runtime framework. New libraries only through a DDR (candidates the spikes may justify: an audio onset/beat detector, a subject tracker for video reframing — prefer existing ffmpeg / footage-analyst paths first). Tauri 2 stable APIs only (no `unstable` feature — DDR-109).

---

## How this plan runs (operating model for one autonomous session)

### Roles (agent team, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)

| Role | Count | Owns | Never touches |
| --- | --- | --- | --- |
| **Lead / integrator** (the `/goal` session itself) | 1 | the Progress log + coverage ledger, phase gates, merge order, and every **shared file**: the action/shortcut registry, the typed `dgn` bridge, `app.jsx` residue, `http.ts` + `server.ts` route registration (`CANVAS_SAFE_API` + routes map), the four runtime-state lists (DDR-115), `whats-new.json`, `dist/` (rebuilt once per integration point), DDR recording, commits | lane internals while a lane owns them |
| **Lane owners** (teammates) | **4 concurrently** (lanes L1–L4 below) | their work package's files, each in its own git worktree | shared files (they send the lead a contract/patch request on the team channel) |
| **Verifier** (teammate, rotating) | 1 | the single test lane, screenshots, fidelity evidence against canvas artboards, e2e runs, critics, a11y | product code (reports only) |
| **Security pair** (spawned at gates) | 2 | `flow:security-auditor` + `flow:ethical-hacker` reports | code |

Lane owners talk to each other on the team channel to agree interfaces *before* coding (AI ↔ Editing on "one AI run = one undo step"; Annotations ↔ Editing on stable element ids; DS ↔ Editing on token chips; Share ↔ hub lane on roles). An agreement is a short contract file under `apps/studio/client/v2/contracts/<topic>.md` (or the package equivalent) linked from the Progress log; the lead merges it before either side codes against it.

### Lanes (why four, not eleven)

The canvas iframe files (`canvas-lib.tsx`, `canvas-shell.tsx`, `tool-palette.tsx`, `use-tool-mode.tsx`, annotations modules) are shared by Modes, Editing, Annotations and Video — parallel streams there only manufacture merge conflicts. So:

| Lane | Runs (in order) | Files it owns |
| --- | --- | --- |
| **L1 Canvas iframe** (serial) | 24 px fix (P2) → S3 Modes/Present → S2 Editing → S4 Annotations → S7 Video & kinds | canvas-lib / canvas-shell / tool-palette / annotations / timeline modules |
| **L2 Shell panels** | S1 Navigation & history → S11 Advanced/Diagnostics/Settings/empties → S8 Export/Import/Assets → S10 Design system canvas (last — depends on 11, 13, 14) | `apps/studio/client/v2/<area>/*`, their `routes/<area>.ts` |
| **L3 AI & create** | S5 AI chat → S6 Create/Home/Onboarding (client part) → S12 AI & tooling sweep (each package already updates its own plugin pieces; S12 closes the rest + agent-driven e2e) | chat/ACP modules, run registry, Home client |
| **L4 Native + hub + cloud** | Phase 3 tabs/identity/Home → S9 hub roles/ACL/invites/links/presentation route → S9/S6 cloud.maude.sh pages + e-mail | `apps/desktop/src-tauri`, `apps/hub`, `apps/cloud`, `apps/cells` |

The Share/collab *client* part of S9 runs on L2 after S1; the client part of S6 on L3 after S5.

### Branching, worktrees, commits — Phase 0 on `main`, then one branch

- **Phase 0** (split `app.jsx` into modules) is committed on `main` and pushed — Michal's explicit call; it is move-only and behaviour-identical.
- Right after it, the lead creates **`feat/maude-v2`** from `main`. Every later task is committed there as it finishes (one or a few commits per `V2-x.y`, message prefixed with the id). Only Michal commits to `main`; if `main` moves anyway, the lead merges `main` into the branch at the next phase boundary.
- Each lane owner works in its own worktree off `feat/maude-v2` (never two agents in one checkout — `index.lock` fights) and hands back small commits; the lead integrates them onto the branch in dependency order and runs the gates.
- **Push:** the branch is pushed when Michal asks (or at the PR, E5); the default is commit locally and report. The PR into `main` is opened at the end (Phase 8), with the description generated from the Progress log, phase by phase.
- **Michal's test checkpoints** (non-blocking): at the end of Phases 3, 4, 5, 6 and 8 the lead builds the `.app` from the branch and writes a "Ready to try" entry in the Progress log (build path, what changed, what to try, known gaps). The run continues; Michal's findings go into the ledger as open rows.
- **No v1/v2 switch.** The branch rewrites the old UI in place — no parallel versions. While the branch is mid-way it may be half old, half new; that is fine on a branch. Comparison with today's app = a build of `main` after Phase 0. What keeps features from disappearing: the characterization tests (V2-0.1), the frozen v1 reachability manifest (V2-2.0c, taken before the first visible change) and standing rule 2 — no old element is removed until its v2 home exists in the same commit.
- Stage specific files only, never `git add -A`; check committed content after each commit (`git show HEAD:<file> | grep <sentinel>`); run `scripts/check-import-coherence.sh` at every integration point (CLAUDE.md, v0.51.0 lesson).
- **Hub/cloud changes are additive and v1-compatible**: after the merge they ship in a release before the client depends on them, and v1 desktops keep working against the new hub (tested with a v1 client). Nothing reaches the cloud fleet except through a release tag (CLAUDE.md release flow); rc tags must not trigger fleet/npm-latest workflows (V2-2.0).

### Single test lane

One machine, one suite at a time (memory: parallel runs fabricate failures; `bun test` has clobbered `dist/`). Test runs take a lock (`.ai/state/v2-test.lock`, created/removed by a tiny wrapper `scripts/v2-test-lane.sh`); `git status apps/studio/dist/` before and after every run; revert unintended `dist/` changes. Only the verifier and the lead run full suites; lane owners run their focused tests through the same wrapper.

### Resumability (the run will outlive its context)

- State lives in git: the **coverage ledger** `.ai/scenarios/maude-v2/ledger.json` (every artboard id of 01–15 + every Gate 0 D-row → `open | built | verified` + evidence path + commit) and the **Progress log** at the bottom of this file (dated lines with SHAs). One checkpoint commit per finished task.
- Resume = `git log` + ledger + Progress log (plan checkboxes lag — CLAUDE.md). `/flow:resume` and a fresh context re-enter from them.
- Every task ID (`V2-<phase>.<n>`) is atomic and has its own "Done when".
- Long work goes to background agents; the lead keeps only conclusions in context. If the run must stop, it stops at a phase boundary with the branch green and booting — every phase leaves a working app.

### Memory and task discipline (enforced by hooks, not by good intentions)

Verified 2026-10-08 against the installed kgai plugin (1.7.x) and Claude Code docs: kgai's SessionStart (capture rules), PostToolUse (turn marks) and Stop (forces the capture decision) hooks are guaranteed only in the **lead** session. For subagents and agent-team teammates the documented events are `SubagentStart` / `SubagentStop` and `TaskCreated` / `TaskCompleted` / `TeammateIdle`. `/goal` is model-judged; a command **Stop** hook can gate it deterministically. The native task tools (`TaskCreate` / `TaskList` / `TaskUpdate`, a shared team list with dependencies and claim states) persist across compaction, but in-process teammates do not survive a session resume. So the run harness (V2-0.0) adds project hooks that are **no-ops unless the run marker `.ai/state/v2-run.json` exists and its `sessionId` matches the hook input's `session_id`** — Michal's other sessions in this repo are unaffected even while the run is active. The lead writes the marker as its first action and deletes it when the goal is met or the run is paused. (Whether teammates' hook inputs carry the lead's `session_id` is undocumented — V2-0.0's smoke test checks it; if they carry their own, the lead appends each teammate's id to the marker's `members` list when it spawns them.)

**Knowledge graph — read before, write after, reconcile at every gate**

1. **Read.** At each phase start the lead runs `kg search "<topic>"` for the phase's topics and `maude kg context --about "<area>"` for the areas it touches, and puts a short digest (untrusted data, DDR-130 guard) into every teammate's brief. A `SubagentStart` hook injects the capture rules and one line: "Before any structural change run `kg search \"<topic>\"`; end your hand-back with a `## Decisions` block (or `## Decisions: none`)."
2. **Write.** Every structural decision becomes a graph node the moment it is acted on — lead turns are forced by kgai's Stop hook; teammates/subagents are forced by a `SubagentStop` hook that **blocks** a hand-back without the `## Decisions` block. Naming is deterministic so double writes converge (kgai identity = hash(kind:name)): `decision:maude/v2-<task-id>-<slug>`, linked `IN_REPO → repo:maude` and `REFERENCES → plan:maude/feature-maude-v2-redesign`. The lead ingests every hand-back's Decisions block at the integration point (`/flow:record-ddr` for DDR-sized ones, `maude kg ingest` otherwise). Gate 0 outcomes and every Phase 1 spike are DDRs.
3. **Checkpoints.** Each finished task also lands in the graph as a checkpoint on the plan node (task id, status, commit SHAs) — the kgai path of `/flow:execute` — next to the ledger and the Progress log.
4. **Reconcile.** At every phase gate the lead lists the phase's commits, new DDR files, Progress-log decision lines and hand-back Decisions blocks, and checks each has a node (`kg query`); missing ones are ingested before the gate passes. `scripts/v2-done.sh` re-checks the whole run: every `kg:` reference in the Progress log resolves and `maude kg doctor` is healthy.

**Native task list — the working view of the plan**

5. **Launch** from Claude desktop with Opus 5.5; the env vars come from the repo's `.claude/settings.json` (agent teams, task tools, Stop-hook block cap 50). The run's first action writes the marker, then verifies `TaskCreate` exists; if it does not, it stops and reports.
6. **Load.** At each phase start the lead creates one native task per `V2-x.y` of that phase (dependencies as in the plan) and, for work packages, one task per canvas section's artboards (from the ledger). Teammates claim from the shared list. The plan + ledger stay the master copy; the native list is rebuilt from the ledger after any compaction or resume (teammates are re-spawned from it — they keep no state).
7. **Honest ticking.** A `TaskCompleted` hook **refuses** completion unless the task id has a Progress-log line with a commit SHA, and — for artboard tasks — its ledger rows carry an evidence path. A `TaskCreated` hook refuses tasks without a `V2-` id or ledger reference (no off-plan work sneaks in).
8. **Reconcile.** Phase gate = native completed set == ledger `verified` rows == Progress-log entries for that phase; any mismatch blocks the gate.
9. **Finish.** The `/goal` condition says the transcript must show `bash scripts/v2-done.sh` exiting 0. A `Stop` hook blocks the lead from ending while that script fails, unless `.ai/state/v2-waiting-for-michal.md` exists (an owner-run step from G0-E, written with what is needed). (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=50` is set in the repo settings.)

### Standing rules (every teammate, every commit)

1. **Precedence of truth:** Gate 0 register → `CONTRACT.md` → the topic-owning canvas (table below) → other canvases → `_kit.tsx` → inventories. The kit is a static mock (spans, no real buttons) — lift its *look and structure*, never its markup.
2. **Nothing deleted.** Before removing any UI element, find its v2 home in the Nothing-deleted contract; if it has none, stop and add a row (Progress log) — don't remove it.
3. **Words and voice** exactly per CONTRACT §3–§4 (no "we"/"I", "AI" without article, "moved to the trash", one action per toast, dialog title verb = primary button, relative times then "6 Oct, 14:05", counts with real nouns). Mono text only inside Advanced bodies, Diagnostics and the code view.
4. **Tokens only** — every colour/space/radius/shadow/motion value from `maude-v2` tokens; no hex; weights stop at 600; tabular figures for live numbers; reduced motion collapses every animation.
5. **Testids are an API.** Re-emit an existing `data-testid` on the v2 element that carries the same meaning; new ones follow `<area>-<thing>[-<id>]`. Update tours (`data-tour`) and What's New spotlight targets in the same change.
6. **Bundles:** after any `client/**` change, rebuild release-minified (`cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`) and commit `dist/client.bundle.js` + `dist/styles.css`; `git status apps/studio/dist/` before and after every `bun test`.
7. **Boots:** every server / e2e spawn with `NO_OPEN=1`; in-tree verification boots with `MAUDE_NO_AUTOBUILD=1`; run the `apps/studio` bun suite alone (no parallel hub suite on the machine); a synced project copied for testing is unlinked first (strip `linkedHub`, `_sync.json`, `_state`).
8. **Canvas-origin routes** go in BOTH `CANVAS_SAFE_API` (`http.ts`) and the `startCanvasServer` routes map (`server.ts`), with a `GET → 405` test (DDR-088). Privileged routes in neither.
9. **Runtime-state paths** (`_*`) update all four lists together (DDR-115: `git/service.ts`, `cli/lib/gitignore-block.mjs`, `.gitignore`, `sync/file-membership.ts` + hub mirror).
10. **Regression tests fail first** — revert the fix and watch the test go red before trusting it.
11. **Decisions go to the graph:** each DDR-worthy choice → `/flow:record-ddr` (kgai active, `repo:maude`).
12. **Hidden is not refused.** Any capability a role or shell hides in the UI is also refused by the server/hub; ⌘K uses the same visibility predicates as the panels, folds and menus (one predicate set in the registry).
13. **Old bindings die with new ones.** A v2 key binding lands in the same commit that removes the colliding v1 binding (T/H/S/N/I/E/B, ⇧⌘A, ⇧⌘G, ⌘E, native ⌘N); the registry's uniqueness test runs per scope.
14. **Surface = substrate.** A new or changed capability lands, in the same change, as: a registry action (params, effect, minRole, server route, undo, and `agent`: `file` → the format doc + skill section, `cli` → the verb, or `human`) → a server route enforcing `minRole` → the file-format doc/schema and the skill that teaches it, or the `maude` verb → the plugin command/skill/agent/hook updated → a contract test proving the UI path and the AI path (file edit or verb) give the same result. The parity coverage test (V2-2.4b) only ratchets down.
15. **Versioned files never break a peer.** Any new field in a versioned file (`.annotations.json`, `.meta.json`, comps, tokens) goes through the format-version rules of V2-1.12 and the `maude migrate v2` migrator (V2-2.14), with a mixed v1/v2 sync test in both directions.
16. **Design systems follow the schema.** New or changed system files pass `maude design ds-check`; canvases follow the switchability S-rules (G-ds-schema §4.8) — enforced by the keeper Pass C, the `/design:new`/`/design:edit` lint and the PostToolUse hook.

### Topic-owning canvas (when two canvases differ, the owner wins)

| Topic | Owner | Topic | Owner |
| --- | --- | --- | --- |
| Menu, keys, words, voice | CONTRACT.md | Share sheet, roles, presence, comments | 10 |
| Home, create flow, empty canvas | 01 (+05 for empty) | Version history, Trash, ⌘K, tabs, navigation | 11 |
| Onboarding, Settings General/Connections | 02 | Assets tab, import, photo | 12 |
| AI chat panel (canonical header, runs, queue) | 03 | Design system canvas, tokens, components | 13 |
| Modes, toolbars per mode, Present | 04 | Objects, inspector, layout, text, pen, components | 14 |
| Empty states | 05 | Annotations, Preview toolbar, stickers | 15 |
| Advanced folds, Diagnostics, Settings › Advanced | 06 | Timeline, video | 07 |
| Artboard kinds, presets, warnings | 08 | Export sheet, Exports, Handoff | 09 |

---

## Gate 0 — Decisions register (Michal signs before the run)

Status: **signed by Michal 2026-10-08** (all recommendations accepted; A8 overridden; A12 kept and drawn in canvas 13). **A13–A20 added after the surface/substrate audit: A14–A20 signed; A13 rewritten to "files are the API" (no MCP) — waiting for Michal's confirmation.** Michal ticks ✓ (accept recommendation) or writes an override in the last column. The run reads this table at start and **refuses to begin Phase 1 while any row is ⏳**. After sign-off, the lead folds the outcomes into `CONTRACT.md` §6/§7 (and the kit header) in the first commit of Phase 1, so the canvases' spec stays the single source.

### G0-A · Product model (from `v2-open-questions.md`)

| ID | Question | Recommendation (default) | Source | ✓ / override |
| --- | --- | --- | --- | --- |
| A1 | Project tabs | **A — native macOS window tabs** (decided 2026-10-08). Home = its own window tab (⌘T). Tab avatar/menu from CONTRACT §6 → the tab's right-click uses the native tab menu plus "Sign in as another account…" in the project pill menu | 11 pn-ab | ✓ decided |
| A2 | AI = bring your own Claude account | Yes. Cloud does not include AI; the connect sheet appears on first Ask AI; Claude Pro/Max sign-in or API key | 02, 03, §7 | ✓ Michal 2026-10-08 |
| A3 | Cloud trial | 14 days, no card, starts at first sign-in. At the end: projects stay readable and exportable, editing and sync pause behind "Choose a plan" | 02 | ✓ Michal 2026-10-08 |
| A4 | One AI per artboard | Yes. A second ask waits in line or "Run on a copy"; different artboards run side by side; a whole-canvas ask starts on free artboards first. No "Run anyway" | 03 ai-queue-rule | ✓ Michal 2026-10-08 |
| A5 | Quitting while AI runs | AI runs on this Mac and stops; the dialog warns; "Keep going" on next launch resumes the session. No server-side AI in v2.0 | 03 ai-quit | ✓ Michal 2026-10-08 |
| A6 | Roles | Can view = look only · Can comment = look, comment, download · Can edit · Owner. Editors move to the trash; only owners clear it out. Self-hosted hub without view-only accounts hides Can view and links | 10, §6 | ✓ Michal 2026-10-08 |
| A7 | Mode switch + keys | Edit · Preview · Present in the Share cluster; Viewing slot for read-only. Keys ⌥⌘P Preview · ⌥⌘↵ Present from the selected artboard · ⇧⌥⌘↵ Present from the start · L pointer (Present). Add to CONTRACT §1/§2 | 04 md-keys | ✓ Michal 2026-10-08 |
| A8 | AI under the pointer in Preview | ~~AI never changes the artboard under your pointer~~ — **override (Michal, 2026-10-08): AI changes show live in Preview, under the pointer too.** Present is unchanged: a change lands when you move on to the next artboard (audience-facing) | 04 md-edge-ai | ✓ Michal 2026-10-08 (override) |
| A9 | Design system lives on a canvas | Yes — one "Design system" canvas pinned in Canvases; files are its Advanced layer and are generated from it; outside changes arrive as a review | 13, §7 | ✓ Michal 2026-10-08 |
| A10 | Editing the same object | Soft lock: others see the editor's colour ring and read-only fields + Comment; frees on deselect / blur / 30 s idle / disconnect. AI holds its run's objects the same way | 14, §7 | ✓ Michal 2026-10-08 |
| A11 | Object keys | ⌥⌘G frame (⌘G alias) · ⇧⌘G remove frame · ] [ · ⌘] ⌘[ · arrows 1 px / ⇧ 10 px · ⌘D · ⌫ · ⇧⌘L lock. In Preview ⌘G / ⇧⌘G = group / ungroup annotations | 14, 15 | ✓ Michal 2026-10-08 |
| A12 | Several design systems in one project (today `designSystems[]` holds N, each canvas declares its own; this repo runs `maude` + `maude-v2` side by side) | **Kept (Michal, 2026-10-08), drawn in 13 › "Several systems in one project" (`ds-multi-panel` · `ds-multi-switch` · `ds-multi-menu` · `ds-multi-migrate`)**: each canvas uses one system; every system in use is pinned in the Canvases panel and has its own Design system canvas; one is the default for new canvases (a new canvas inside a folder whose canvases all share a system uses that one); "Switch canvases to another system…" is the usual review with a Scope (This canvas · Folder · Whole project); a system no canvas uses is a draft; migration turns every used `system/<ds>/` folder into its own Design system canvas | 13 ds-multi-*, ds-many-*, ds-edge-migrate | ✓ Michal 2026-10-08 |
| A13 | How Claude drives v2 — **files are the API** (Michal's direction 2026-10-08, revised: no MCP layer) | Claude works as today: skills teach it and it edits the project's files directly — canvas TSX/JSX, `.meta.json`, `.annotations.json`, tokens, comments — which stay readable JSX/JSON on disk (Maude's core advantage). Every v2 capability is therefore one of: **(a) file** — a documented, versioned format + a skill that teaches it (canvases, artboards and kinds, interactions/links, Present order/notes, annotations incl. stickers/votes/arrows, DS tokens/components/several systems, comments, assets metadata); **(b) CLI verb** — a `maude` command for what is not a plain file edit (render/export, AI media generation, transcription/beats, sync/hub, Version history restore and Trash with their sync semantics, opening something in the user's window, checks like `ds-check`); **(c) human-only** (invite, roles, links, clear out trash, sign-in/keys/accounts, hub link/unlink, billing, Bring everyone here). The invariants on file edits — one AI per artboard, soft locks, Made by AI, one AI run = one undo step, trash instead of `rm`, element ids kept — are held by design-plugin hooks around Claude's file tools plus the studio's file watcher. CLI permissions: only read-only/local helper verbs are auto-approved in the AI chat; shared or destructive verbs show the permission card; human-only actions have no verb (`Bash(maude:*)` narrowed accordingly) | H-ai-parity §3 (MCP part dropped) | ⏳ confirm |
| A14 | Design-system schema | Three tiers (Michal's direction): **core** = the 68 DDR-043 names + functional roles (accent soft/on-soft/text, focus ×3, selection, scrim, status fg/soft/text, weights, tracking), Light + Dark, swapped mechanically; **expressive slots** = 7 kinds `<kind>-N` (display ramp, brand colours, illustration palette, chart, texture, graphic device, signature motion), optional, unbounded, paired by kind on a switch; **own** = `--x-*` / `ext.*`, unlimited, usable by canvases, restyled by AI on a switch. 14 core components with one class contract + `@maude/ds`. Checked by `maude design ds-check` (structure only — never values or aesthetics; DDR-043 holds). Supersedes C1 | G-ds-schema §4 | ✓ Michal 2026-10-08 (95 required roles) |
| A15 | Source of truth for tokens during v2 | The system CSS stays authoritative and `tokens.json` is generated from it until the Design system canvas can edit tokens (S10); then the canvas becomes the source and the CSS is generated (CONTRACT §7) | G §7 q2 | ✓ Michal 2026-10-08 |
| A16 | Existing systems | The run brings Maude's own systems (`maude`, `maude-v2`) up to the schema in this repo. Other projects' systems (Alligators, studyfi…) are never edited by the run — users get the in-app "Bring it up to the schema" offer when they open them | G §5 | ✓ Michal 2026-10-08 |
| A17 | v1 ↔ v2 peers on one project | v2 writes a `formatVersion: 2` marker per project; a 1.x patch release (shipped before any v2 rc) opens a v2-format project read-only with "Update Maude to edit"; `maude migrate v2` upgrades files idempotently with a dry-run and a reverse step | I #2 | ✓ Michal 2026-10-08 |
| A18 | Vote secrecy | Hidden ballots are truly secret only in cloud projects (the hub holds ballots and the timer); in local projects "hidden" means hidden in the UI, and the vote sheet says so | I #11 | ✓ Michal 2026-10-08 |
| A19 | Can view and downloads | Can view blocks every download/export route on the server; the DDR states plainly that a viewer's browser still holds what it renders (a courtesy limit, not DRM) | I #5 | ✓ Michal 2026-10-08 |
| A20 | UI language | **English only, no message catalog in v2.0 (Michal, 2026-10-08).** Counts still use real nouns for 1 and many (CONTRACT §4); a later translation is a separate project | I #14 | ✓ Michal 2026-10-08 |

### G0-B · Scope — "drawn as if it exists" (all NEW; recommendation: all in v2.0, per Michal's brief)

| ID | Feature set | Recommendation | ✓ / override |
| --- | --- | --- | --- |
| B1 | Links between artboards and canvases (On click / On hover), presenter view on a 2nd display, presentation link with Catch up, per-artboard notes + order | In | ✓ Michal 2026-10-08 |
| B2 | Follow (exists → restyle), Go to, **Bring everyone here** + spotlight, @mentions with Mac notification, Dock badge and e-mail | In | ✓ Michal 2026-10-08 |
| B3 | Video: word-by-word captions, edit-by-transcript, beat detection + Cut to the beat, music ducking, poster frame, linked formats with per-format framing (subject tracking), Sound only, 4K, .srt | In; subject tracking may ship as "centre + manual nudge" if the spike shows no reliable tracker (record in DDR) | ✓ Michal 2026-10-08 |
| B4 | Export: JPG, folder batch, file-name tokens, cloud vs this Mac render, colour profile, font-licence check, export a past version | In | ✓ Michal 2026-10-08 |
| B5 | 300 dpi print PDF default (today 96) | In | ✓ Michal 2026-10-08 |
| B6 | Search inside pictures (opt-in AI descriptions per project) | In | ✓ Michal 2026-10-08 |
| B7 | Brand import from a website | In | ✓ Michal 2026-10-08 |
| B8 | AI: offline prompt queue, drag-and-drop attachments, Open in terminal, chats grouped per canvas, full-text chat search | In | ✓ Michal 2026-10-08 |
| B9 | DS: per-canvas "left out" updates (update dot), outside-change review, conflict pick, AI three directions, team libraries on cloud.maude.sh, migration of `system/<ds>/` folders | In | ✓ Michal 2026-10-08 |
| B10 | Annotations PROPOSED set: arrows bound to artboards/elements with live re-route, annotations ride with their artboard, vote stamps + vote sessions, sticky ↔ comment, video time-pinned stickies, section Fold | In | ✓ Michal 2026-10-08 |
| B11 | Version history: thumbnails, named versions, "what changed" in words, restore one artboard, object-scoped history | In; object-scoped history may be derived from the journal — DDR in Phase 1 | ✓ Michal 2026-10-08 |

### G0-C · Contradictions between canvases (recommendation resolves each)

| ID | Contradiction | Recommendation | ✓ / override |
| --- | --- | --- | --- |
| C1 | ~~Token names: files keep the DS's existing names~~ — **superseded by A14** (one schema; designer names are display names in `tokens.json`; the words→CSS table emits schema names) | see A14 | ✓ → A14 |
| C2 | Save status words: kit has a 5th "Not saved" | Keep CONTRACT's four; a failed, un-queued write shows "Not saved" as the 5th word only while true, with one action (Retry). Amend §6 | ✓ Michal 2026-10-08 |
| C3 | Native ⌘N = New Project vs CONTRACT ⌘N = New canvas | Native File menu becomes New canvas ⌘N · New project… ⇧⌘N · Open project… ⌘O · New Home tab ⌘T; add a Window menu (native tab commands) | ✓ Michal 2026-10-08 |
| C4 | New canvas naming | "Untitled canvas" (+ " 2", " 3"); Home-created canvases are named from the prompt by a non-AI heuristic; offline create uses the same rule | ✓ Michal 2026-10-08 |
| C5 | Render-error "Go back to 14:05" | Creates a new version (same as Restore — Now is never rewritten) | ✓ Michal 2026-10-08 |
| C6 | Accounts: per project (11) vs app-wide (02 Settings) | Settings › General lists every account on this Mac; each project tab is bound to one; "Sign in as another account…" from the pill menu | ✓ Michal 2026-10-08 |
| C7 | Comments filters (Open · Mine · Resolved) drop today's All | Open · Mine · Resolved · All (All kept — nothing deleted); default Open | ✓ Michal 2026-10-08 |
| C8 | Comments panel slot: left (04) vs right (05) | Right side, floating, like the AI chat panel (the left slot stays Canvases · Layers · Assets) | ✓ Michal 2026-10-08 |
| C9 | Exports entry: Share-cluster icon (09) vs Export › Advanced (06) | Exports icon with progress ring in the Share cluster once any export exists + ⌘K "Exports" + Menu › View › Exports | ✓ Michal 2026-10-08 |
| C10 | Trash entry | Last row of the Canvases panel + ⌘K "Trash"; clear-out owner-only | ✓ Michal 2026-10-08 |
| C11 | Two Share surfaces (02 popover vs 10 sheet) | 10's sheet everywhere; 02's local-project state ("Move to cloud…") added to it | ✓ Michal 2026-10-08 |
| C12 | "Stamp" vs "Stickers" | UI says **Stickers (E)**; "stamp" in copy means only vote stamps; internal id may stay `stamp` | ✓ Michal 2026-10-08 |
| C13 | Sticker pack order / names | CONTRACT order: FigJam Doodle · Life Style · Opposing Thoughts · Project status; display names trimmed ("Project status"), authors as in manifests | ✓ Michal 2026-10-08 |
| C14 | Marker inks/tips: kit vs 15 | 15 wins: Marker · Highlighter · Eraser tips; inks Ink (default) · red · amber · green · blue + more | ✓ Michal 2026-10-08 |
| C15 | Gap "Auto" vs Spacing "Packed / Space between" | One control: Spacing seg Packed · Space between; the Gap menu lists tokens + "A number, no token…" | ✓ Michal 2026-10-08 |
| C16 | Inspector kind chip | Always the artboard kind (Web page · Fixed size · Print · Video); height mode is a row, not a chip | ✓ Michal 2026-10-08 |
| C17 | ⌫ on an object vs "moved to the trash" | Objects inside an artboard: removed (⌘Z and Version history bring them back). Artboards, canvases, assets, chats, tokens: moved to the trash | ✓ Michal 2026-10-08 |
| C18 | Linked DS library state word | A distinct state "Linked library — view only", not the people-permission word "Can view" | ✓ Michal 2026-10-08 |
| C19 | 07's export sheet vs 09 | Build 09's sheet only; 07 supplies content (format ticks, captions, render location). Captions default Off; estimates computed, never copy | ✓ Michal 2026-10-08 |
| C20 | Retry label | "Retry <name>" button, manual (never auto) | ✓ Michal 2026-10-08 |
| C21 | Inspector export (08 buttons vs 09 section) | 09's Export section (+/−, presets, Copy as PNG ⇧⌘C); 08's buttons are its default presets per kind | ✓ Michal 2026-10-08 |
| C22 | Video length cap (08 warns at 2 min; 07 shows 4:12 without warning) | Cap per artboard, warn everywhere past 3600 frames, "Allow longer" stored per artboard up to the exporter ceiling (18000) | ✓ Michal 2026-10-08 |
| C23 | Figma comments | Figma design comments → comment pins; FigJam comments → stickies; fix the sheet's option label | ✓ Michal 2026-10-08 |
| C24 | Figma frames' kind | Arrive as Fixed size at Figma px | ✓ Michal 2026-10-08 |
| C25 | Print guides precedence | View › Advanced › Print guides = default for all; per-artboard switch in the print inspector overrides | ✓ Michal 2026-10-08 |
| C26 | Key collisions by focus | Focus-scoped resolution: focused text field > timeline focus (S split, I/O loop, ←/→ frames, ⌘+/− timeline zoom) > selection (generated image ←/→ takes) > mode tools > global. ⌘B always splits | ✓ Michal 2026-10-08 |
| C27 | Chats across people | Chats are personal and stay on this Mac (as today `_chat/`); others' *running* runs on a shared canvas are visible View only; others' finished chats are not listed | ✓ Michal 2026-10-08 |
| C28 | Two AI panel headers in 04/05 | 03's canonical header only | ✓ Michal 2026-10-08 |
| C29 | Resolved stickies | Struck through in place; ⌘K "Hide resolved stickies" toggles (per user) | ✓ Michal 2026-10-08 |
| C30 | Can comment and AI | No AI chat panel for Can view / Can comment | ✓ Michal 2026-10-08 |
| C31 | Present order | Canvas order (row by row, left to right) unless "Order and notes…" set an order; notes + order + skip in `.meta.json` (versioned) | ✓ Michal 2026-10-08 |
| C32 | Presence colours | Stable per person per project (coral reserved for AI); "You" is yellow locally | ✓ Michal 2026-10-08 |
| C33 | Bring everyone here | Editors and owners only; followers leave with esc | ✓ Michal 2026-10-08 |
| C34 | Settings › Advanced rows without backing | "Local server port": display only. "Faster canvas engine": not built. "Send anonymous usage data": not built (no-telemetry DDR, T23). "Decision memory": shows count when kgai is set up, else "Not set up" | ✓ Michal 2026-10-08 |
| C35 | Timeline tracks (four fixed) vs today's overlay lanes | Text · Graphics · Video · Music by default; "+ track" under timeline Advanced adds Video 2 / Music 2; existing comps' overlay lanes migrate to Video 2 | ✓ Michal 2026-10-08 |
| C36 | Sound-only and captions file formats | Sound only = .m4a (AAC); .wav under Advanced. Captions file = .srt; .vtt under Advanced | ✓ Michal 2026-10-08 |
| C37 | Errors & recovery (crash recovery, full disk) are not drawn | Crash: on relaunch a one-line callout "Maude quit unexpectedly. Your work up to 14:05 is here." + Report a bug…; full disk: status word "Not saved" + callout "This Mac is out of space — changes wait here until there's room." + Show in Finder | ✓ Michal 2026-10-08 |
| C38 | Home tab backend shape (no project) | A project-less **Home** server mode (one shared instance, loopback) serving the same client bundle in Home mode; the shell owns the cross-project index (recents, pins, open tabs, thumbnails cache). Confirm in Phase 1 spike S1 | ✓ Michal 2026-10-08 |

### G0-D · Homes for today's features that no canvas places (nothing-deleted)

These rows extend the 124-row ledger drawn in `06 Advanced` (`ITEMS`). Recommendation = the home; Michal ticks or moves it.

| ID | Today | v2 home (recommendation) | ✓ / override |
| --- | --- | --- | --- |
| D1 | Browse tool | Preview mode (Hand + click uses the design); "?" sheet lists it under "Keys and tools that moved" | ✓ Michal 2026-10-08 |
| D2 | Pen B, Rect R, Ellipse O, Highlighter I, Eraser E, Section ⇧S | P · Shape R · Edit › More › Ellipse · Marker tip · Marker option · S — all listed in "?" › moved | ✓ Michal 2026-10-08 |
| D3 | Canvas-palette Export ⌘E, ⌘⇧E re-run last export, in-canvas export dialog | One sheet ⇧⌘E; "Export again" on every Exports row; ⌘E unbound | ✓ Michal 2026-10-08 |
| D4 | ⇧⌘R Refresh tree, T toggle tree, H hidden files, S DS view, N new board | ⇧⌘R kept (Canvases › Advanced + ⌘K); tree → ⌘\ / panel icon; hidden files → Canvases › Advanced switch (no key); DS → pinned row; new board → ⌘N | ✓ Michal 2026-10-08 |
| D5 | Files panel: New folder, inline composer, folder menu, drag-drop, keyboard tree nav, open-comment count, Figma/experimental badges, non-canvas file preview | Canvases panel (11 pn-organise / pn-move); counts and badges as row meta; preview opens from hidden files | ✓ Michal 2026-10-08 |
| D6 | Right-click menus: world (Fit/Reset view, Paste artboard, Export project ZIP / canvas as separate), artboard (Theme, Kind, Fit, Reset position, Convert to absolute, Open Timeline), element (Inspect, Select layer, Insert ▸, Replace image, Convert children to absolute, Copy/Paste style, Hide, Lock, Export selection), multi-select align/distribute | v2 artboard / object menus (14) + an **Advanced ▸** submenu holding every remaining item; Kind + Theme in the artboard inspector (Theme under its Advanced); world menu kept on empty-canvas right-click | ✓ Michal 2026-10-08 |
| D7 | Contextual element toolbar (copy selector/id, inspect, align, Tidy up) | Align bar (14) + object menu Advanced ▸ | ✓ Michal 2026-10-08 |
| D8 | Comments: All filter, Reopen, Delete, file group headers | Comments panel (C7); Reopen in a resolved thread; "Delete comment" for your own comments; grouping by canvas | ✓ Michal 2026-10-08 |
| D9 | Chat: "Implement N comments", empty-state CTAs, per-chat Rename/Archive/Delete/Copy transcript, ModeBanner, rate-limit banner, ErrorCard, Permission/Elicitation prompts, OS notifications | 03 equivalents (suggestion chips, chat list menu with Move to trash, inline permission/choice cards, "used up until HH:MM", Needs you) | ✓ Michal 2026-10-08 |
| D10 | Git panel: empty states, "Cloud is saving", result banners, Undo a restore, Retry cloud history, Save all, DiffView (compare, side by side / overlay wipe, zoom), chat-guard before branch switch | Version history (11) + its Advanced (06 ad-history); pixel compare under Version history › Advanced › "Compare pictures" | ✓ Michal 2026-10-08 |
| D11 | CloudBar project list (Connect/Disconnect), "Connect this folder" deep link, file deep-link dialog, device-code sign-in | Settings › Connections (cloud projects on this Mac) · 11 deep links · browser sign-in sheet with "Use a code instead" | ✓ Michal 2026-10-08 |
| D12 | TeamProjects "Your team's own server" form, SyncConsentDialog, Sync notice Dismiss, delivery attention list, SyncBanner diverged/rejected, CloudRoleBanner, mode-hint toast | Settings › Connections "Add a team server…" · consent shown once in the Move-to-cloud/first-link flow + Settings › Advanced · Diagnostics › Sync details · status-word callouts · access-status word | ✓ Michal 2026-10-08 |
| D13 | Tours (usage, collab, quick-setup), SetupChecklist, "Start quick setup", What's new panel/toast, ReportBugDialog (3 steps), Help modal sections | Help › Take the tour (tours rewritten for v2) · Help › "Set up Maude…" (checklist) · Home first-run line · Help › What's new + quiet dot · Help › Report a bug… (unchanged flow) · Help › Help and guides | ✓ Michal 2026-10-08 |
| D14 | Figma token Test, transcription engines (whisper.cpp / Scribe / Groq), keyframe engines (Gemma / ffmpeg / Blind), Generate model select + Generate/Insert | Settings › Connections "Test" · full selects in Settings › Advanced · AI chat Generate mode (12) with model select in its Advanced | ✓ Michal 2026-10-08 |
| D15 | Timeline: AI clip Generate ✨, ClipInspector (Speed, Audio, Crop, Grade, Text, Transition), transport (Loop, Mute, Volume, comp picker), clip context menu (~17 items) | Timeline (07) + clip right-click menu (all 17 kept) + clip inspector with Grade/Crop/Transition frames under its Advanced | ✓ Michal 2026-10-08 |
| D16 | Photo knobs (8 sliders, Duotone, Grain, Pattern, Mask, Background) | Photo (12) Looks + Light/Colour; every knob under Photo › Advanced | ✓ Michal 2026-10-08 |
| D17 | Palette "Toggle theme", "New video…" | ⌘K "Theme" + Settings › General · ⌘K "New video" + New artboard › Video | ✓ Michal 2026-10-08 |
| D18 | Inspector Advanced raw CSS (~33 properties, custom CSS property rows, HTML attribute rows) and the Designer/Advanced vocabulary toggle | Designer is the only default; inspector › Advanced carries the full raw editor unchanged (not only CSS · tokens · id) | ✓ Michal 2026-10-08 |
| D19 | Native OS menu: About, Check for Updates…, Quit, Help › Report a Bug | Unchanged (CONTRACT §1); Check for updates also in Settings › Advanced | ✓ Michal 2026-10-08 |
| D20 | Persisted prefs (~40 `mdcc-*`/`maude-*` keys, `prefs.json` panelSides/layersMode) | Versioned migration to v2 homes (fold state, pinned panels, theme); "seen" flags re-keyed so upgraders get the v2 tour once | ✓ Michal 2026-10-08 |

### G0-E · Owner-run steps (the autonomous run builds the code, then stops and reports at these)

An agent cannot obtain credentials, DNS or money. The run implements and tests everything against stubs/test modes, then lists these in the Progress log as **Waiting for Michal**; the ledger counts them as `built` (not `verified`) until Michal confirms.

| ID | Step | Why owner-run |
| --- | --- | --- |
| E1 | Sending domain + e-mail provider credentials for mention e-mails and invites on cloud.maude.sh (DNS SPF/DKIM) | credentials, DNS |
| E2 | Trial/billing in live mode — stays in the separate `cloud-live-payments-rollout.md`; v2 ships against Stripe test mode | legal/accounting, live keys |
| E3 | Google OAuth client / consent screen for the cloud sign-in page (if a new client id is needed) | Google console |
| E4 | Notarization/signing of the rc `.app`, and installing the rc on Michal's Mac for the soak | Apple credentials, owner's machine |
| E5 | Pushing the branch, opening the PR, tagging `v2.0.0-rc.N` (Phase 0's push to `main` is pre-approved — it happens after Michal has tried the split) | Michal's standing rule: no push unless asked |
| E6 | Staging cell for hub/cloud verification (or permission to use `alligators` staging) | live tenant |

---

## Phase 0 — Split `app.jsx` into modules (on `main`, pushed — not gated by Gate 0)

Move-only refactor that every later phase stands on (hardening backlog T6 + T7–T10). It changes no behaviour and no pixels, so it does not wait for Gate 0. Done by the lead (or one teammate) on `main`; Michal tries the app, then it is pushed. Only after that is `feat/maude-v2` created.

| ID | Task | Done when |
| --- | --- | --- |
| V2-0.0 | **Run harness** (see "Memory and task discipline"): `scripts/v2-done.sh` (red by design), the ledger skeleton `.ai/scenarios/maude-v2/ledger.json` generated from every artboard id in `.design/ui/v2/01…15` + the 00 rules + G0-D rows, `scripts/v2-test-lane.sh`, and project hooks in `.claude/settings.json` gated by the run marker (`.ai/state/v2-run.json`, session-id match; `_state`-style runtime file, so add `.ai/state/v2-run.json` to `.gitignore`): `SubagentStart` (kg rules + Decisions requirement), `SubagentStop` (block a hand-back without `## Decisions`), `TaskCreated` (V2 id / ledger ref), `TaskCompleted` (Progress-log SHA + evidence), `Stop` (block while `v2-done.sh` fails unless waiting-for-Michal). Each hook has a fail-first test (planted bad input → blocked) | hooks fire in a smoke session that owns the marker, do nothing in a second session without it, and the smoke test records whether a teammate's/subagent's hook input carries the lead's session id; ledger lists every artboard id |
| V2-0.1 | **Characterization tests + testid contract (T6).** Pin today's behaviour of every region that will move (menubar menus, status bar chips, sidebar/tree, viewport states, ⌘K palette, export dialog, inspector tabs, comments panel, banners, help/shortcuts, settings); write `apps/studio/client/TESTIDS.md` (testid → meaning → owner); convert the 11 tests that grep `app.jsx` source text into behaviour tests (they would break on a pure move) | full studio suite + desktop e2e default and parity lanes green **before** the split; the contract lists every testid used by e2e, tours and What's New spotlights |
| V2-0.2 | **Split `app.jsx` along its regions** — move-and-export only, one region per commit: `DockSlot`/`DOCK_PANELS`, `CommandPalette`, `AssetPicker`, `ExportDialog`, the tree (`DirRow`/`DsFolderRow`/`FileRow`/`CanvasRow`/`Tree`/`Sidebar`), `CollapsedRail`, `HelpModal`, `SHORTCUT_GROUPS`/`ShortcutsOverlay`, the six menu dropdowns + `Menubar`, `Viewport`, the design-system view (`TokenLadder`/`TypeLadder`/`SystemView`/`Gallery`), `StatusBar`, `CommentsPanel`, the banners, the inspector cluster (`ColorPicker`, `TokenPopover`, `GridTracksEditor`, `CssKnobs`, `LayerRow`, `InspectComputed`, `ArtboardKnobs`, `InspectorPanel`), and `App()`'s effect groups into hooks (keyboard, WebSocket, `dgn` listener, prefs) — into `apps/studio/client/{shell,tree,inspector,dialogs,menus,hooks}/…` (names may follow the existing `client/panels/` convention). No renames of exported behaviour, no logic edits, no testid changes | `app.jsx` ≤ ~2,000 lines; every test from V2-0.1 green after each commit; release bundle byte delta within a small band; `check-client-boots-source.mjs` green; `scripts/check-import-coherence.sh` green; screenshots of the main screens identical to before |
| V2-0.3 | **Ship it** — rebuild the committed bundle release-minified (`cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`), commit `dist/client.bundle.js` + `dist/styles.css`; build the desktop debug app and run the desktop e2e default + parity lanes; write a "Ready to try" note in the Progress log; **Michal tries it, then push to `main`**; create `feat/maude-v2` from the pushed `main` | pushed commit SHAs in the Progress log; branch created |

## Phase 1 — Architecture spikes and DDRs (on `feat/maude-v2`, scratch worktrees)

Each spike is a time-boxed prototype in a scratch worktree, ending in a DDR via `/flow:record-ddr` and a contract note. Spikes run in parallel (≤ 4 teammates). **First commit of the run:** the lead folds the signed Gate 0 outcomes into `CONTRACT.md` §1/§2/§6/§7 and the kit header (C12 etc.) and records one DDR "Maude v2 decisions register" (each row as a bullet with Michal's answer) — so no rule lives only in this plan.

Default approaches the spikes start from (SHIPPER's minimal paths — keep them unless the spike proves they fail the canvas):

- **Home (1.1):** a project-less `/_home` route served by a shared Home instance (or the boot sidecar); each project server writes `~/.config/maude/index/<hash>.json` (canvases, artboards, thumbnails refs, AI state) on change/shutdown; Home reads live servers + snapshots for closed ones.
- **Mode (1.2):** `ToolProvider` (`use-tool-mode.tsx`) stays the executor in the iframe; the shell is the source of truth via `set-mode` + echo (same pattern as `view-chrome`); the two toolbars are a re-skin of `tool-palette.tsx`.
- **Undo + AI (1.5)** — must reconcile three statements (BREAKER): CONTRACT "⌘Z includes changes made by AI", per-user stacks, and "one AI run = one version". Starting point: one AI run = one version via the held AI stage (`sync/action-stage.ts`, `sync/autocommit.ts`, `/_api/project/undo`); artboard attribution by `DCArtboard id=` line ranges of the edited source; no merge of AI writes into the client undo stack; "AI works here" via `collab/ai-activity.ts` + `artboard-activity-overlay.tsx`.
- **DS pinning (1.6):** content-addressed, not git (local non-git projects, cloud cells, shallow clones): each published system revision is a versioned snapshot `system/<ds>/revisions/<hash>.json`; a left-out canvas records `dsRev: <hash>` in `.meta.json` and loads that snapshot; the base for outside-change detection is the last revision the app wrote (versioned, so peers agree — no per-Mac `_state` base). "Update N canvases" rewrites `dsRev` in one version. Team library = a read-only cloud project; linking copies the revision in and records source + hash.
- **Roles (1.7):** add one role below today's `viewer` (which already means Can comment) in `apps/cloud/membership.mjs`, `apps/hub/src/role-matrix.mjs`, `apps/studio/read-only-mode.ts` together; per-canvas sharing = a path-scoped grant in `apps/cloud/grants.mjs` / `project-access.mjs`.
- **Co-edit (A10):** soft locks over the existing awareness channel (`use-collab.tsx`), no leases.
- **Version diff (1.9):** artboard line-range diff between revisions → style-prop changes in words; anything else falls back to "Changed layout in <artboard>"; time travel renders old source read-only through the canvas build sandbox; one-artboard restore replaces the range as a new version.
- **Presentation link (B1):** the audience view reuses `hub/embed-page.mjs` + the presenter's position on the awareness room; presenter view = a second Tauri window `?present=audience` on the second display.
- **Video (1.10):** subject framing starts as manual focus-point keyframes; automatic tracking only if the spike finds a reliable path on the existing `smart-frames`/footage-analyst verbs (B3 fallback).

| ID | Spike | Must answer | Feeds |
| --- | --- | --- | --- |
| V2-1.1 | Home window + cross-project index (C38) | How Home is served; where recents/pins/thumbnails/open-tab state live; how Home talks to project sidecars without leaking across origins | P3, S6, S1 |
| V2-1.2 | Mode + toolbar ownership | Shell owns mode; the iframe renders the two toolbars and tools; new `dgn` messages (`set-mode`, mode echo, `occluded-insets` for floating panels); one typed message table | P4, S3, S2, S4 |
| V2-1.3 | Action / shortcut registry | One registry (id, label, where-path, keys, visibility predicate by role/shell/mode/focus — extended by V2-1.11 with params, effect, minRole, server route and the AI path — file / CLI verb / human) feeding menus, ⌘K, "?", native menu, generated help and docs; focus-scoped key resolution (C26) | P2, everything |
| V2-1.4 | Stable element ids | Ids that survive AI rewrites and drive Layers, locks, undo scopes, bound arrows, co-edit; canvas-only metadata store (lock, hide-in-editor, Place freely) that never leaks to export | S2, S4, S5 |
| V2-1.5 | Unified undo + AI attribution | One op log for user + AI; one AI run = one step; per-user stacks; Undo history; map ACP edits to artboard ids (rings, queue, Made by AI) | S5, S2, S10 |
| V2-1.6 | DS-as-canvas storage + per-canvas pinning | Where the Design system canvas lives; token model (`tokens.json` + DDR-043 names, C1); generator → `colors_and_type.css`; base snapshot for outside-change 3-way diff; how a left-out canvas keeps old values (versioned frozen token snapshot); usage index | S10 |
| V2-1.7 | Hub roles + per-canvas ACL | Can view role (or viewer sub-flag), trash vs clear-out split, canvas-scoped membership, link roles, access requests, self-hosted capability report; migration of existing members | S9 |
| V2-1.8 | Floating panel material on WKWebView | `backdrop-filter` islands over a panning canvas: `maude design perf --engine safari --studio` on the Alligators-scale fixture, several passes; **go** only if p95 frame time and long-task count stay within the pre-v2 run's spread; otherwise the material falls back to a solid surface + the DS shadow (record the numbers in the DDR) | P4 |
| V2-1.9 | Version history semantics | Thumbnails per version, named versions, "what changed" in words (per artboard / element), restore one artboard, object-scoped history from the journal; cloud and local parity | S1 |
| V2-1.10 | Video intelligence | Beat detection, speech regions for ducking, word timings → captions/edit-by-transcript, subject tracking for per-format framing (or the B3 fallback) | S7 |
| V2-1.11 | **AI-operability contract — files are the API** (A13) | Registry `agent` field (`file` / `cli` / `human`); the file-format docs + JSON schemas Claude edits against (canvas conventions, `.meta.json`, `.annotations.json` v2 elements, tokens/components manifests, comments); which operations need a `maude` verb because they aren't plain file edits (render/export, generation, sync/hub, history restore, trash, `maude design open <canvas>[#artboard]` into the user's window, checks); hook contract around Claude's file tools (run bracket, `edit.check` locks/queue/scope/trash-not-rm, `edit.touched` attribution + element-id check) via the studio's loopback API, fail-open with no studio; CLI permission tiers (auto only for read-only/local helpers) | P2, S12, all |
| V2-1.12 | **File formats across versions** (A17) | `formatVersion` per project + per file schema versions; what a v1 peer does on read/write; migrator shape (dry-run, idempotent, reverse); mixed-peer sync rules on the hub file plane | P2, P3, S4, S7, S10 |
| V2-1.13 | **DS schema v1** (A14) | `apps/studio/schema/ds-schema-v1.json` registry (roles, slots, own namespace, alias + collision tables, component class contract, icon vocabulary, `.t-*` type roles), fallbacks CSS, conformance levels, S-rules for canvases, Bring-it-up engine shape | P2, S10, S2, S5 |
| V2-1.14 | **One offline outbox** | One persisted outbox for AI prompts, invites, comments, offline create and cloud exports: ordering, dedupe, expiry, replay against a target that is gone (trashed artboard, revoked role) | S5, S6, S8, S9 |
| V2-1.15 | **AI run registry + hub leases** | Run schema (id, chat, owner, artboards, state), per-artboard leases with TTL on the hub for shared projects and locally otherwise, queue persistence, quit/crash release, soft-lock interplay (A10) | S5, S2 |
| V2-1.16 | **ACL leak matrix** | Where a canvas-scoped member could still see other canvases — sync file plane, Yjs rooms, shared assets, git/Version history, Whole-project export/ZIP, ⌘K, usage index, comments, presence — and the server check for each | S9 |
| V2-1.17 | **Indexes + thumbnails** | One index service for Home, ⌘K, usage, kind counts, recent, picture descriptions (A20/B6 budgets): build, incremental update, crash-safe staleness, cloud "Shared with you"/"not on this Mac" API; one thumbnail renderer | S1, S6, S8, S10 |

**Done when:** every spike has an accepted DDR in the graph, a contract note under `apps/studio/client/v2/contracts/` (or `apps/<pkg>/…/contracts/`), and an entry in the Progress log; CONTRACT.md carries every Gate 0 outcome.

---

## Phase 2 — Foundation (on `feat/maude-v2`, zero visible change)

Absorbs hardening backlog T3, T13 (minimum), T17 (vocabulary), T21′, T23 (diagnostics data), studio-suite-required (T6 and T7–T10 are Phase 0).

| ID | Task | Done when |
| --- | --- | --- |
| V2-2.0 | **Prerelease channel + release-trigger gating (T21′) — FIRST.** Today `cells-deploy`, `hub-image`, `render-deploy` and `build-binaries` all fire on `v*.*.*`, which also matches `v2.0.0-rc.1`: an rc tag would roll the production cell fleet, deploy render and npm-publish to `latest`; `bump-version.sh` rejects rc versions. Extend the version grammar, split the globs (rc → build + npm `--tag next` + prerelease desktop updater feed only; no fleet/render/hub `:latest`), updater excludes prereleases for stable users, parity script accepts rc | a dry-run rc tag builds without touching stable users or the fleet (verified in workflow logs) |
| V2-2.0b | **Done script + ledger go live** — extend the V2-0.0 `scripts/v2-done.sh` with every gate command of Phase 8, the kg reconciliation check (every `kg:` reference in the Progress log resolves; `maude kg doctor` healthy) and the native-list / ledger / Progress-log equality check | script runs and exits non-zero (red until the end, by design) |
| V2-2.0c | **Frozen v1 reachability manifest** — before any chrome moves, enumerate every reachable v1 entry point (6 `MENU_NAMES` dropdowns, palette actions, ~15 keydown handlers, 25 panels, Settings tabs, right-click menus, Sync/Git panel actions, native menu) into `apps/studio/client/v2/v1-manifest.json`; the nothing-deleted test maps each to a v2 path and stays **red until the mapping is complete** | manifest committed; test exists and is red |
| V2-2.2 | **Biome on client (T3)** — format-only commit, then errors-only ratchet | `pnpm lint` covers `apps/studio/client` |
| V2-2.3 | **State out of `App()`** — after the Phase 0 split, move the ~160 `useState` of `App()` into a few stores/contexts along the module seams (the `Menubar` ~70-prop drilling goes away); behaviour-identical | characterization tests (V2-0.1) green; bundle delta within band |
| V2-2.4 | **Action + shortcut registry** (V2-1.3) replacing the ~15 keydown listeners; today's palette actions and menus read from it | old shortcuts behave identically (characterization tests); "?" generated from the registry |
| V2-2.4b | **AI paths from the registry** (A13, V2-1.11) — `scripts/gen-actions.mjs` → committed `apps/studio/actions.manifest.json` (drift gate like roadmap.json) listing every action with its AI path; generated `/design:help`, `maude design help`, docs page and a `studio-actions` skill index (which file to edit / which verb to run, per capability); the missing `maude` verbs for non-file operations; narrow `Bash(maude:*)` to read-only/local helpers; design-plugin hooks (UserPromptSubmit/Stop run bracket, PreToolUse `edit.check`, PostToolUse `edit.touched`); app↔plugin↔CLI `manifestVersion` handshake (SessionStart warns when the plugin is older than the app) | parity coverage: every action that exists at this point has a file or CLI path or a human-only reason; contract tests red-first; `Bash(maude:*)` gone from the AI chat's allowed tools |
| V2-2.5 | **Server route modules** — split new-route homes out of `http.ts` (`routes/<area>.ts` + one table) so work packages never edit the same switch | route table test; `CANVAS_SAFE_API` parity test |
| V2-2.6 | **Token pipeline** — maude-v2 tokens into the client under `.maude-v2[data-theme]`; generated iframe HUD tokens (no hard-coded values in `canvas-shell.tsx`); site token sync retargeted to maude-v2 (T13 minimum); `--guide` token (14) | tokens gate green; HUD block generated |
| V2-2.7 | **Prefs migration** (D20) in `ui-prefs.ts` + client, versioned, read-old/write-new | migration test with a fixture of every old key |
| V2-2.8 | **Known bugs:** fixed artboard loses 24 px (canvas-lib label inside height); CLI `--option marks=crop` / numeric options dropped; `export zip` without scope rejected; ⇧⌘E double meaning; print PDF 96 → 300 dpi (B5) | each has a fail-first regression test |
| V2-2.9 | **Diagnostics data (T23)** — ring-buffer logs per source (sync, server, AI, export) with 7-day retention, status providers, "Copy diagnostic report", no-telemetry DDR | Diagnostics API returns all four sources; redaction test |
| V2-2.10 | **Typed shell↔canvas bridge** — one typed `dgn` message table (existing messages + `set-mode`, mode echo, `occluded-insets`) shared by shell and iframe; geometry test that Fit/reveal honour insets | bridge test green; every existing message still handled |
| V2-2.12 | **Boot gate extended to interaction** — `check-client-boots(-source)` and the `.app` gate assert, in the minified build with the `__TAURI__` stub, that the app is usable, not just mounted: today `#root` + the main panels respond; from Phase 4 on the v2 landmarks (the project pill opens the menu, ⌘K opens Search, the mode switch posts `set-mode`) | gate fails on a planted mounted-but-dead shell |
| V2-2.13 | **Full studio suite → required** (`quality.yml` `studio-suite` off `continue-on-error`) once the quarantine list is named or empty; triage the `/_api/figma/import` cluster | job required on PRs |
| V2-2.14 | **`maude migrate v2`** (A17, V2-1.12) — annotations, `.meta.json`, comps' overlay lanes → Video 2, chats → canvas link, DS folders → schema manifests; dry-run, idempotent, reverse; the `formatVersion` marker | Alligators-scale fixture migrates and reverses byte-for-byte; mixed v1/v2 peer sync test green in both directions (memory: sync is asymmetric) |
| V2-2.15 | **DS schema enforcement** (A14, G-ds-schema §6 E1–E11): registry + fallbacks CSS, `maude design ds-check` (exit 0/10/11, `--json`, `--emit`, `--fix=mechanical`), templates emit the schema, completeness-critic C6/C10–C13 + **fix the C7 false-fail**, keeper Pass C (switchability), `/design:new` + `/design:edit` lint, PostToolUse hook, `@maude/ds` + `<DSRoot>` in canvas-lib; bring `maude-v2` and `maude` up to the schema (A16) | `ds-check maude-v2` exits 0; a planted collision/literal is caught by each enforcement point; every existing canvas in this repo still renders identically (screenshot diff) |
| V2-2.16 | **Runtime-state classification + outbox store** — every new runtime path (run registry, outbox, index, thumbnails, describe sidecars, vote state, fold state) classified across the four DDR-115 lists; a drift test for the `.gitignore` ↔ `gitignore-block.mjs` pair; the V2-1.14 outbox store | tripwire tests red on a planted unclassified path |
| V2-2.17 | **Index + thumbnail service** (V2-1.17) | Alligators-scale build time recorded; staleness-after-crash test; incremental update on file change |
| V2-2.18 | **1.x compatibility release** — a 1.x patch that honours `formatVersion: 2` (read-only + "Update Maude to edit"); hub/cloud changes that v2 needs, additive and v1-compatible, cut from the branch into their own PRs/releases **before** any v2 rc (E5: Michal pushes and tags) | released; a v1 client against the new hub passes its e2e |
| V2-2.19 | **Stable element ids** (V2-1.4) — ids preserved across AI rewrites (skill rule + PostToolUse check), canvas-only metadata store | moved here from S2 so S1, S4 and S5 don't wait on lane L1; a rewrite fixture keeps every id |

**Phase gate:** parity tests green for the actions that exist; `ds-check maude-v2` exit 0; the mixed-peer test green; `/flow:validate` green on the branch; desktop e2e default + parity lanes green; packaged-app gates green on a built `.app`; screenshots of the old UI unchanged (baseline set saved under `.ai/scenarios/maude-v2/baseline/`); the frozen v1 manifest committed.

---

## Phase 3 — Native project tabs, identity profiles, Home window (lane L4)

Tabs and profiles are native and independent of the web UI. Until Phase 4 replaces the old chrome, the existing project switcher keeps working inside each tab; Home renders the v2 Home.

The Rust/backend spec is the archived plan **`.ai/plans/archive/feature-desktop-project-tabs-and-identity-profiles.md`** (T1–T9, T12–T14 with file:line anchors — re-verify anchors, `app.jsx` moved in Phase 2). Its UI tasks T10/T11 are **replaced** by v2: "Open in new tab", the profile chip and "Sign in as another account…" live in the project pill menu, Home, and Settings › General (02, 11), not in RepoBranchSwitcher/IdentityBar.

| ID | Task | Done when |
| --- | --- | --- |
| V2-3.1 | Profiles registry, per-project binding, per-profile keychain slots, per-spawn bridge keys, OAuth into a profile (old T1–T4) | cargo tests incl. two profiles round-trip independently |
| V2-3.2 | One `WebviewWindow` per project, `tabbing_identifier`, `data_store_identifier` (macOS 14+), focused-window model, reap policy (never a windowed instance; never with AI running or unsent changes), `MAX_INSTANCES` rationale (old T5–T7) | e2e `project-tabs` green |
| V2-3.3 | **Home window** per V2-1.1 (⌘T, Back to Home), cross-project index, open-once (opening an open project focuses its tab), resting tabs past 5, relaunch restores all tabs (11) | e2e: Home lists recents across two projects; reopen focuses |
| V2-3.4 | Native menu per C3 + Window menu; server env + `/_config.profile` + CLI `HUBS_CONFIG_PATH` parity (old T8–T9) | `cargo test`; `node --test cli/lib/hubs-config.test.mjs` |
| V2-3.5 | Notifications per project ("AI is done", "Needs you", mentions) for unfocused tabs; Dock badge; deep links routed to the right window (`maude://<project>/<canvas>#<artboard>`) | e2e `project-tabs-identity`; notification click focuses the right tab |
| V2-3.6 | Security fan-out on the token bridge, profile paths, cross-window events, deep links, tab spam (old T14) | 0 blockers from both reviewers |

---

## Phase 4 — The v2 shell replaces the old chrome (every capability rehomed)

One owner: the lead + one shell teammate (L2), with L1 doing the iframe toolbars. Work packages start only after this phase's gate. **Same phase, not later:** the e2e selectors, tour `data-tour` anchors and the 26 What's New spotlight targets get v2 equivalents here (each scenario is rewritten to the v2 UI in the same change that moves its chrome; the characterization tests from V2-0.1 are ported, never dropped), so no phase runs without a regression signal.

| ID | Task (canvas refs) | Done when |
| --- | --- | --- |
| V2-4.1 | **Window body = canvas edge to edge**; floating panels that fold into their corner icon; ⌘\ Hide/Show panels; "Pin panels to the side" (06 ad-pinned); occluded-insets sent to the canvas so Fit lands in the visible area | panels never cover a "fit" artboard; reduced motion = cut |
| V2-4.2 | **Project pill + the one menu** exactly CONTRACT §1 (File, Edit, View + Advanced, Help, Version history, Share…, Export…, Diagnostics + Advanced, Settings…), all rows from the registry; Back to Home | every row reachable by keyboard; ⌘K finds every row |
| V2-4.3 | **Share cluster**: faces · status word (§6) · mode switch (Edit/Viewing · Preview · Present⌄) · Hide panels · Share / Ask to edit · Exports icon (C9) · comments count | status machine covers Saved / Syncing… / Offline — kept on this Mac / Local project / Not saved (C2) |
| V2-4.4 | **Left panel** Canvases · Layers · Assets tabs with Advanced fold and Trash row (C10); **AI chat panel** shell (03 header); **Inspector** appears on selection | old Sidebar/Dock/CollapsedRail gone, their features rehomed per ledger |
| V2-4.5 | **Two toolbars** in the canvas (Edit: Select V · Hand H · Frame F · Shape R · Pen P · Text T · Image I · Component ⇧I · More; Preview: Hand · Sticky N · Comment C · Marker M · Arrow A · Shape · Text · Stickers E · Section S) + ToolbarMorph; annotation keys switch Edit → Preview, esc back | `mode-toggle` + toolbar tests rewritten and green |
| V2-4.6 | **⌘K Search** (registry-backed; canvases + artboards + tools + settings with where-paths; "Ask AI" last row; "Nothing called …" copy); **"?" shortcuts** with "Keys and tools that moved" fold | ⌘K finds every Advanced item by name ("hub", "figma", "api key", "print guides", "New artboard — A4"…) |
| V2-4.7 | **Settings** General · Connections · Advanced (02 ob-settings, 06 ad-settings, ad-edge-hub); **Diagnostics** submenu with status words + Advanced (06 ad-diag, ad-logs, ad-syncd = today's Sync panel whole) | every today-setting has a row (ledger) |
| V2-4.8 | **Old chrome replaced**: in-app menubar, status bar, mode stamp, path, artboard count, banners → status words/callouts/Diagnostics per the ledger (the old component code is deleted in the same change once its replacement passes; the nothing-deleted test must resolve every item) | none of them remain; the nothing-deleted test resolves each to a v2 path |
| V2-4.9 | **Every shell**: desktop, local browser, cloud tab (no tabs/Home; "Back to Home" → dashboard), viewer (Viewing / Can comment toolbars), embed (DDR-242) — one parity contract | `shell-parity` rewritten as the v2 parity contract; green in `:parity` and `:parity:cloud` |
| V2-4.10 | **Fold component** (one quiet "› Advanced" row, remembered per panel per Mac across projects; ⌘K "Open/Close all Advanced sections") | fold state persists; Reset in Settings › Advanced |

**Phase gate:** the frozen v1 manifest (V2-2.0c), the 124-row ledger and the G0-D rows each resolve to a reachable v2 element (`scripts/check-v2-nothing-deleted.mjs` walking the registry + DOM in a headless boot per shell and role) — this is the first time that test goes green; interactive boot gates green on a built `.app`; desktop e2e green in both shells; per-role server-enforcement tests green for the roles that exist today (owner · member · viewer; Can view arrives with S9 and gets its tests there) (rule 12); a11y-auditor 0 blockers on the shell; design-critic ≥ 4.0 on shell screenshots vs the `01 Create Flow` / `11` reference artboards.

---

## Phase 5 — Work packages, wave A (the core loop)

Work packages (S1–S11) run on the lanes defined in "How this plan runs" — L1 is serial (S3 → S2 → S4 → S7), L2/L3/L4 run beside it. Each package: read its inventory section + its canvases first; agree contracts with neighbours on the team channel; build it in place (no parallel version); capture fidelity evidence per artboard into the ledger; hand back. "Owns" below is indicative — shared files always go through the lead.

| Package | Canvases | Scope (summary — the inventory is the checklist) | Owns (indicative) | Key neighbours |
| --- | --- | --- | --- | --- |
| **S1 Navigation & history** | 11, 05 (nav empties), 01 (find) | Canvases panel at 93 canvases (folders, pins, sort, inline rename, move, search with accent folding + typos + artboards), cross-project ⌘K groups, artboard jump list, Version history ⌥⌘H (thumbnails, named versions, words diff, restore whole / one artboard, compare), Trash with artboards (owner-only clear-out), moved-folder / removed / access-changed states | `client/v2/canvases/*`, `client/v2/history/*`, history/trash routes | S5 (AI versions), S9 (roles) |
| **S2 Editing** | 14 | Artboards (8 handles, preset ruler, smart guides magenta, equal gaps, Tidy, ⌘D rhythm, rename in place), objects (enter frames, breadcrumb, multi-select, rotate, nudge, frame/unframe, z-order, lock, hide), auto layout with token ruler + reorder slot, constraints, text in place (Czech ties, Language, Case, style overrides), shapes + corner dots, Pen + Combine shapes, images + crop mode, components (⇧I picker, instances, variants, overrides, Detach), the 10-section inspector + Advanced (D18), Interaction section, words→CSS writer, co-edit soft lock (A10), Undo history, Figma paste bar, keyboard/VoiceOver model | canvas-shell editing modules, `client/v2/inspector/*`, edit routes | S3, S4, S5, S10 |
| **S3 Modes & Present** | 04 | Mode state machine (V2-1.2), Preview (live design, links between artboards/canvases with back), Inspect/measure (⌥), Present one by one (lift, controls, video autoplay, counter excludes skipped), Present the canvas, presenter view on a 2nd display, Order and notes…, presentation link with Catch up, what-shows-per-mode table, esc everywhere, AI live in Preview / lands on move-on in Present (A8 — needs per-artboard reload gating in Present) | mode/present modules, Tauri multi-display, hub `/present/<canvas>` | S2 (Interaction), S9 (link auth) |
| **S4 Annotations** | 15 | Preview toolbar tools (sticky colours + per-person last colour, stack + Fan out, Comment, Marker 3 tips + inks, Arrow with styles, Shape, Text, Section + Fold, templates panel + AI "describe it"), Stickers gallery (vote stamps, Recent, 4 packs, keyword search, follow-pointer drop at 160 px, Replace / Flip), quiet rendering in Edit with click-through, LOD mosaic < 25 %, bound arrows with live re-route + dangling, ride-with-artboard, votes, sticky ↔ comment, video time pins, votes per A18 (hub-held ballots in cloud, UI-hidden locally), bound-arrow re-route within a measured frame budget, Can comment denial line, FigJam import entry, AI read/apply/write | annotations-* modules, `StickerPicker` successor, annotation model | S2 (ids), S3, S7 |
| **S5 AI chat** | 03 (+ AI parts of 01, 05) | Run registry + hub leases (V2-1.15) with a two-Mac race test; the undo interleaving test matrix (you · AI · Tereza, out-of-order "Undo this chat"); outbox-backed queue; canonical panel (title ⌄, ✦ N runs, +, hide), simple composer with selection chip + paperclip, suggestions with why, result describes itself, per-artboard rings/tags + "Made by AI", one AI per artboard queue + Run on a copy (A4), run list (yours + others View only), chat list grouped by canvas + full-text search + Move to trash, attachments + folder consent, inline permission/choice cards, Needs you across panel/pill/notification/Dock, offline/setup/used-up queue (prompt never lost), quit/close-tab dialog + Keep going (A5), Undo this chat, Open in terminal, connect sheet (A2), Advanced (model, effort, permission mode, fast, view, context %, raw log) | `client/panels/Chat*` successors, ACP runtime + run registry routes | S2 (undo), S1 (versions), S10 (DS make) |

**Wave A gate:** each package's actions are in the registry with agent surfaces or exemptions and their plugin pieces updated (rule 14); its ledger rows `verified` (evidence per artboard, hash-pinned to the canvas file), its e2e scenarios green, its inventory checklist 100 % ticked or carrying a Progress-log exception approved by the lead, design-critic ≥ 4.0 per canvas, a11y 0 blockers, regression tests shown red-then-green, the branch green and booting in every shell (desktop, browser, cloud tab, viewer, embed).

## Phase 6 — Work packages, wave B (domains)

| Package | Canvases | Scope (summary — the inventory is the checklist) | Key neighbours |
| --- | --- | --- | --- |
| **S6 Create, Home, Onboarding** | 01, 02, 05 (home/first-run empties) | Home (What shall we make?, starters, "Start with an empty canvas ⌘N", target-project chip, recents/pinned/shared with you, projects by account), first canvas in 2 min (AI drafts artboard by artboard, one undo step), render-error card (C5), offline create, first launch = Home + sign-in card, cloud.maude.sh browser sign-in with return-to + "Use a code instead", invite link through download → install → sign-in → the comment (deferred deep link), "Just a local project", Move to cloud later, Advanced doors (self-hosted hub, existing folder/repo, CLI + Claude Code plugin install sheet), two accounts, offline first launch, project naming (C4) | S9 (cloud web, invites), S5 (connect sheet) |
| **S7 Video & kinds** | 07, 08 | Floating timeline (compact / full width) shown with a video artboard (⇧⌘T keeps it open; tap Space plays, hold = Hand), four tracks + "+ track" (C35), trim/split/reorder, captions word by word + edit by transcript, beat grid + Cut to the beat, ducking, poster frame, linked formats + per-format framing, AI cut streaming (shots placed live, Stop keeps them, one undo step), other takes, waiting-for vs missing footage, clip menu + inspector (D15); New artboard picker (App · Web page · Social · Print · Video, "Fixed size"), kind inspectors, safe zones (never exported), kind filter chips, change-kind makes a copy, one warning style, print sheet (paper, bleed, safe margin, RGB line), video cap (C22) | S8 (export), S2 (F tool), S4 (time pins) |
| **S8 Export, import, assets** | 09, 12 | One export sheet (Scope always: Selection · This canvas · Folder · Whole project + estimate; formats PNG/JPG/SVG/PDF/print PDF/MP4/GIF/Sound only/HTML/PPTX/Canva/ZIP; file-name tokens; Save to; cloud vs this Mac; colour profile; font check; past version), Exports panel (history, Export again, Retry <name>, partial "Exported 114 of 115"), done toast "Show in Finder", Handoff sheet (⇧⌘H) with targets, inspector Export section (C21), CLI parity; Assets tab (groups, usage, Not used, keyboard place ↵, wide browse, drop/paste, converters PSD/HEIC/PDF), search in pictures opt-in (B6), Figma import (frames as pictures + Make editable), brand import (logo + website), photo per use + "Apply to every use", Generate with N takes | S7, S10 (brand → DS review) |
| **S9 Share, collaboration, cloud** | 10, 02 (web), 05 (viewer) | Invite-first Share sheet (roles, This canvas / Whole project scope, link row with Copy link secondary, who can open, expiry, pending invites, Share › Advanced = local link, app link, GitHub invite), Ask to edit → owner, presence (artboard, idle, in a browser, in Comments), Follow / Go to / Bring everyone here + spotlight, comments (Open · Mine · Resolved · All, @mentions, video time, print mm), mention delivery (toast, Mac notification, Dock badge, e-mail), offline / back online, object-level conflict with Keep both, trashed while open, local → cloud, twelve people, access ends ("Your last changes were saved first"); **hub**: roles per V2-1.7, per-canvas ACL closing every leak in the V2-1.16 matrix, Can view per A19 with its per-role tests, invites, links, access requests, presentation route support; **cloud.maude.sh**: sign-in, invite pages, account (people, billing + trial A3, Macs, download everything, delete), mention e-mails + preferences | S1, S3, S6, S10 |
| **S10 Design system canvas** | 13 (+ 14 tokens/components) | Schema-backed switching (one review, nothing to map, AI restyles own tokens + hand-picked colours — 13 ds-multi-switch), "Bring it up to the schema" = `/design:setup-ds --upgrade-schema` engine with a before/after screenshot diff (13 ds-multi-schema), content-addressed revisions (1.6), several systems per project (A12: a pinned group when more than one is in use, each with its own Design system canvas, a default for new canvases, switching with a Scope, drafts, per-folder migration), pinned "Design system" row (two lines, empty "Make a design system"), DS canvas (Brand · Colour · Type · Space & shape · Motion · Components · Patterns), Light | Dark per token + DsBar, edit tokens in place with live contrast, reach view, "Update N canvases" review with ticks (left out → update dot), component masters (variants × states × sizes), outside-change review (Keep / Undo) + conflict pick, AI make (3 inputs → three directions → pick / mix → section streaming), many systems + project-wide preview, team library on cloud.maude.sh + linked view-only projects, contrast fix, token to trash with nearest replacement, off-system colour question, migration of `system/<ds>/` (files stay), Advanced (CSS | JSON, files, Hand off tokens, system history, Check the system = critic panel headless) | S2, S5, S8, S9 |
| **S12 AI & tooling evolution** | all (H-ai-parity §4) | Every existing design/flow command, skill, agent and hook updated to v2 concepts and words (~40 items: setup-ds → Design system canvas; export scope words; annotations v2 elements; video tracks; `/design:rollback` re-based on Version history; `/design:edit` run bracket instead of raw curl; ACP brief + CONTRACT voice; generated slash-command list), file-format sections in the `design` skill for every v2 file feature (interactions, Present order/notes, annotations v2, DS manifests, several systems), new commands (`/design:history`, `trash`, `comments`, `system`, `present`, `assets`, `open`), new agents (`asset-describer`, `ds-migrator`), the `contract-voice` skill, `maude design ds-check`/`open`/`artboards-lint`/`canvas-errors`/`logs`/`beats` verbs; one agent-driven e2e per package (the journey done only through Claude's file edits + `maude` verbs, in the AI chat and in terminal Claude Code) | every package |
| **S11 Advanced, Diagnostics, Settings, empty states** | 06, 05 | Every Advanced fold body per 06 (inspector, canvases/layers, AI, share, timeline, export, version history git, DS), Logs/Server/AI setup surfaces, Sync details, Settings rows (D14, C34), code view read-only with artboard → line mapping + syntax error states + Ask AI to fix it, context matrix by role/shell (ad-edge-where), every empty state in 05 (what's missing · why it's fine · one next step), errors & recovery (C37) | all (sweep) |

**Wave B gate:** same as wave A, plus the hub/cloud security fan-out (roles, ACL, invites, links, e-mail, deep links) with 0 blockers, a v1 desktop client verified against the new hub (additive, compatible), and cloud pages verified against a local cell on Node 24 (memory) — a staging cell only after E6.

### Reuse — the cheapest viable path per work package (build on these; don't fork them)

| Package | Reuse |
| --- | --- |
| S1 Navigation & history | `/_api/project/{history,restore,undo}`, `/_api/git/{log,diff}`, `DiffView.jsx`, `sync/trash.ts` (list/restore exist), `command-palette-match.js`, `/_index-data`, `tree-expansion.js`, `use-tree-drag.js`, `file-tree.jsx` keyboard nav |
| S2 Editing | `CssKnobs` / `InspectorPanel` / `inspector-controls.jsx` moved, re-skinned; writes stay on `/_api/edit-*`, `insert-*`, `set-artboard-*`, `/_api/detach-component`, `/_api/component-map`; snapping/measure overlays in `canvas-shell.tsx`; draw engine geometry for Pen boolean ops |
| S3 Modes & Present | `use-tool-mode.tsx` (executor), `tool-palette.tsx` (re-skinned into two toolbars), present-enter path, `participants-chrome.tsx` follow, `hub/embed-page.mjs` |
| S4 Annotations | `annotations-*` modules, `recomputeBoundArrows` in `annotations-bindings.ts` (extend hosts to artboards), `StickerPicker.jsx` + `/_api/stickers` + `apps/studio/stickers/*/manifest.json`, `annotations-context-toolbar.tsx`, DDR-246 lock |
| S5 AI chat | `ChatPanel.jsx` + `acp-runtime.js` engine, `acp-capabilities.js`, `PermissionPrompt.jsx`, `ElicitationPrompt.jsx`, `ReadinessList.jsx`, `collab/ai-activity.ts`, `artboard-activity-overlay.tsx`, `sync/action-stage.ts`, existing OS notifications |
| S6 Create/Home/Onboarding | `/_api/project/create-local`, `/_api/projects/prepare`, `canvas-create.ts`, `scaffold-design.ts`, `/_api/cloud/signin/*` + device-code fallback, door logic of `OnboardingWizard.jsx` / `CreateProject.jsx` / `TeamProjects.jsx` |
| S7 Video & kinds | `TimelinePanel.jsx`, `ClipInspector.jsx`, `timeline-*.js`, `video-comp.tsx`, `clip-ops.ts`, `/_api/clip-edit`, `comp-clips`, `footage`, `maude design transcribe/ingest-footage/smart-frames/audio-search`, `/_api/set-artboard-kind`, `print-overlay-content.tsx`, `exporters/video.ts` |
| S8 Export/Import/Assets | `export-center.jsx`, `/_api/export*`, `exporters/*` (`pdf.ts`, `print/marks.ts`, `pdf-fonts.ts`), `/_api/assets`, `/_api/asset` chunked upload, `import-asset`, `import-brand`, `/_api/figma/*`, `photo-knobs.jsx` + `/_api/photo-edit`, `generate-dialog.jsx` + `/_api/generate/*` |
| S9 Share/collab/cloud | `apps/studio/use-collab.tsx` awareness, `share-dialog.jsx` link logic, `comments-overlay.tsx` + `/_comments`, `apps/hub/src/{role-matrix,embed-page,return-to,browser-auth}.mjs`, `apps/cloud/{membership,grants,project-access,invites,email,email-tokens,checkout,billing,pricing-core,people-page,accounts,oauth-google,device-auth,dashboard}.mjs`, `apps/desktop/src-tauri/src/notify.rs` |
| S10 Design system | `/design:setup-ds` pipeline + `ux-research-agent` (three directions), critic panel (Check the system), `import-brand`, token files under `system/<ds>/`, the git service for `dsRev` |
| S12 AI & tooling | `acp/bridge.ts`, `acp/plugin-bootstrap.ts`, `acp/bootstrap-brief.ts`, `client/panels/slash-commands.js`, `plugins/design/{commands,skills,agents,hooks}`, `cli/commands/design.mjs`, `apps/studio/bin/*.sh`, `cli/lib/plugin-cli-reachability.test.mjs`, `acp-session-allowed-tools.test.ts` |
| S11 Advanced/Diagnostics/Settings | `SettingsPanel.jsx`, `SyncPanel.jsx`, `SourceConflictPanel.jsx`, `GitPanel.jsx`, `RepoBranchSwitcher.jsx` as Advanced fold bodies; `/_api/debug-bundle`, `setup-readiness`, `preflight`, `report-bug.jsx`; T23 log store from V2-2.9 |

---

## Phase 7 — Docs, site, tours, What's New

| ID | Task | Done when |
| --- | --- | --- |
| V2-7.1 | Docs IA: Getting started = install the desktop app and make something; CLI, git, self-hosting, plugins under "Advanced / Explore Maude"; rewrite every page that names old chrome (status bar, menubar, View → History, ⌘⇧G, Inspector words) | `site-content` gate green; grep finds no old-chrome words |
| V2-7.2 | maude.sh marketing pages point at the desktop download first | site build green |
| V2-7.3 | Tours rewritten for v2 (usage, collab, quick setup), spotlight targets updated, old What's New entries marked non-replayable; v2.0 What's New entry (pending, stamped by `bump-version.sh`) | tour tests green |
| V2-7.4 | `CLAUDE.md` + plugin docs updated (runtime contract: tabs = sidecar pool, profiles env, Home mode, new routes/verbs, prerelease channel) | reviewed by the lead |

## Phase 8 — Verification and release candidate

| ID | Gate | Pass condition |
| --- | --- | --- |
| V2-8.0 | **Cleanup** — delete whatever v1 code is still unreferenced and the old token layers (`client/styles.css`, `1-tokens.css`, `*-maude.css`, `5-maude-overrides.css`, leftover menubar/status bar/dock modules). Deleting code is not deleting features: the nothing-deleted test must stay 100 % after it | nothing-deleted 100 %; CSS bundle smaller than before v2; no `.st-*` / `--u-*` left (grep); no dead modules (`knip`-style import check) |
| V2-8.1 | Quality gates | `format → lint → typecheck → tests → build` + parity, tarball, tokens, site-content, import coherence — all green |
| V2-8.2 | Rust | `cargo test` + `clippy -D warnings` |
| V2-8.3 | Desktop e2e | every scenario (old ones rewritten + new: project-tabs, project-tabs-identity, home, modes-present, annotations-stickers, ds-review, export-sheet, share-roles) green on the debug build, 3 consecutive runs |
| V2-8.4 | Cross-shell scenarios | `scenario-runner` on web-desktop for browser, cloud tab and viewer; 0 blockers, parity OK |
| V2-8.5 | **Design fidelity** | Coverage matrix: every artboard id in 01–15 has an evidence screenshot of the implemented state; verifier + `design-critic` / `signature-moment-critic` per canvas ≥ 4.0; copy-critic 0 blockers vs CONTRACT §3–§4 |
| V2-8.6 | **Nothing-deleted audit** | `check-v2-nothing-deleted.mjs` 100 % (124 ledger rows + G0-D rows + inventory §B list) |
| V2-8.7 | A11y | `a11y-auditor` 0 blockers on shell, panels, sheets, toolbars; keyboard-only run of the create flow; VoiceOver strings per 14 |
| V2-8.8 | Performance | `maude design perf` pan/zoom on Alligators-scale fixture (93 canvases, Combine-kampan 21 artboards) in Chromium and WebKit within the pre-v2 spread; floating panels within budget (V2-1.8) |
| V2-8.9 | Security | `security-auditor` + `ethical-hacker` over the whole diff (token bridge, profiles, Home index, canvas-origin routes, hub roles/ACL, invites, links, e-mail, deep links, attachments/folder consent, terminal hand-off) — 0 blockers |
| V2-8.10 | Packaged app | built `.app`: `check-bundle-completeness.mjs --smoke` + `check-client-boots.mjs` (v2 landmark) green; manual smoke on a clean macOS user (no node/bun/claude) |
| V2-8.14 | Performance beyond pan/zoom | 93-canvas panel, index builds, 93 Home thumbnails, 12-person presence, LOD annotations under 25 %, 247 assets — each within a budget recorded in Phase 1 |
| V2-8.15 | Docs for people and agents | `docs/MIGRATING-V1-TO-V2.md`; generated action docs; `site/content/docs/design-system-schema.mdx`; plugin/CLI docs for Claude-driven use |
| V2-8.16 | **AI parity** | parity coverage 100 % (every action has a file path, a CLI verb or a human-only reason); agent-driven e2e green for every package; permission-tier and role tests green; a fresh terminal Claude Code with the released plugin drives the five key journeys end to end, editing files and running verbs only |
| V2-8.11 | **Branch build + PR** | packaged `.app` built from `feat/maude-v2` passes V2-8.10; final "Ready to try" note; Michal's test findings closed in the ledger; PR into `main` prepared with the description generated phase by phase from the Progress log (push + open = E5, Michal) |
| V2-8.12 | After the merge (owner-triggered, outside this run) | `scripts/bump-version.sh 2.0.0-rc.1` through the prerelease channel (V2-2.0): stable users, npm `latest` and the cloud fleet untouched; any hub/cloud change ships v1-compatible first; Michal soaks the rc; promotion to a stable 2.0.0 is a separate release |
| V2-8.13 | Close-out | `bash scripts/v2-done.sh` exits 0; DDRs recorded; `kg` plan node closed; roadmap regenerated; plans `README.md` updated; this plan archived by `/flow:done` after Michal merges the PR |

---

## Coverage matrix (filled during the run)

One row per canvas (summary). The per-artboard truth is the ledger `.ai/scenarios/maude-v2/ledger.json` (V2-0.0): every artboard id → `open | built | verified`, evidence path, commit. "Evidence" = a folder under `.ai/scenarios/maude-v2/fidelity/<NN>/` with one implemented-state screenshot per artboard id + the critic report. `00 Index` contributes its rule list (32 rules) as ledger rows too. The other files in the folder are inputs, not product UI: `v2 Triage` (the Phase-0 board — Core / Contextual / Advanced / Automatic, principles 0–7, the five key journeys that `maude-v2/spec.md` scripts) and `maude-v2-moodboard` (the DS direction).

| Canvas | Artboards | Inventory | Package | Evidence | Critic | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 00 Index | rules + scope (no UI) | A §00 | lead (rule checklist) | — | — | ☐ |
| 01 Create Flow | `cf-*` | A §01 | S6, S1, S5 | | | ☐ |
| 02 Onboarding | `ob-*` | A §02 | S6, S9 | | | ☐ |
| 03 AI Chat | `ai-*` | B §03 | S5 | | | ☐ |
| 04 Modes | `md-*` | B §04 | S3 (+P4) | | | ☐ |
| 05 Empty States | `es-*` | B §05 | S11 (+ owners) | | | ☐ |
| 06 Advanced | `ad-*` | C §06 | S11 (+P4) | | | ☐ |
| 07 Video Editing | `ve-*` | D §07 | S7 | | | ☐ |
| 08 Artboard Kinds | `ak-*` | D §08 | S7 | | | ☐ |
| 09 Export | `ex-*` | D §09 | S8 | | | ☐ |
| 10 Share and Collaboration | `co-*` | C §10 | S9 | | | ☐ |
| 11 Projects and Navigation | `pn-*` | A §11 | S1 (+P3) | | | ☐ |
| 12 Import and Assets | `ia-*` | D §12 | S8 | | | ☐ |
| 13 Design System | `ds-*` | E §13 | S10 | | | ☐ |
| 14 Editing | `ed-*` | E §14 | S2 | | | ☐ |
| 15 Annotations | `an-*` | E §15 | S4 | | | ☐ |

## Nothing-deleted contract

- **§A — the ledger:** `ITEMS` in `.design/ui/v2/06 Advanced.tsx` (124 rows: 115 homes drawn in 06, 7 in other canvases, 2 "not drawn yet" → homed by D5). Grouped view: `.ai/plans/notes/v2-inventory/C-advanced-share.md` § "Nothing-deleted map".
- **§B — today's features no canvas places:** Gate 0 table G0-D (D1–D20).
- **§C — the source inventory of today's features:** `.ai/plans/notes/v2-feature-inventory.md` (every row must map to §A or §B).
- **Audit:** `scripts/check-v2-nothing-deleted.mjs` (created red in V2-2.0c, first green at the Phase 4 gate, must stay green after the V2-8.0 deletion) reads the frozen v1 manifest + a machine-readable copy of §A + §B (`apps/studio/client/v2/nothing-deleted.json`: feature → registry action id / testid → where-path) and asserts each is reachable in a headless boot per shell and role.

---

## Context References

### Must-read before any task (read in parallel)

- `.design/system/maude-v2/CONTRACT.md` — the product contract (after Gate 0 fold-in).
- `.design/system/maude-v2/README.md`, `SKILL.md`, `colors_and_type.css`, `preview/_components.css` — tokens and component classes.
- `.design/ui/v2/_kit.tsx` header — vocabulary of shell pieces (static mock; lift look, not markup).
- `.ai/plans/notes/v2-inventory/F-codebase-survey.md` — where everything lives today, hot files, testids that move, risks.
- `.ai/plans/notes/v2-triage-draft.md` — Core / Contextual / Advanced / Automatic + principles 0–7.
- The work package's own inventory section(s) in `.ai/plans/notes/v2-inventory/A…E` and its canvases in `.design/ui/v2/`.
- `.ai/plans/notes/v2-inventory/G-ds-schema.md` (schema v1, conformance, enforcement), `H-ai-parity.md` (parity matrix, plugin evolution list, parity tests — its MCP recommendation is superseded by A13 "files are the API"), `I-substrate-audit.md` (what the surface needs underneath).
- `CLAUDE.md` (repo) — dev-server contract, two allowlists, runtime-state lists, bundle rules, desktop E2E, release.

### Prior decisions to respect (query `kg search` first)

DDR-009 (Bun), DDR-025 (canvas-lib single source), DDR-043 (bias-free templates, token names), DDR-045 (paths), DDR-054 (untrusted canvas origin), DDR-088 (canvas routes + asset surface), DDR-108/109/132/204 (auth, native shell security, identity cache, one account — amended by Phase 3), DDR-115 (runtime-state taxonomy), DDR-116 (keep both), DDR-125 (ACP multichat), DDR-151 (whiteboard toolkit), DDR-166/168 (ACP identity / bundled plugins), DDR-177 (self-contained bundle), DDR-226 (sync v2), DDR-242/244/246 (annotations v2, stroke view, lock); kg decisions `maude/v2-redesign-design-first`, `maude/v2-ui-principles-floating-chrome`.

### Files to create (indicative — work packages refine)

- `apps/studio/client/v2/**` — shell, panels, stores, registry, contracts, `nothing-deleted.json`
- `apps/studio/routes/<area>.ts` — modular server routes
- `apps/desktop/src-tauri/src/{profiles,windows,home}.rs`
- `apps/desktop/e2e/scenarios/{project-tabs,project-tabs-identity,home,modes-present,annotations-stickers,ds-review,export-sheet,share-roles}.e2e.ts`
- `scripts/check-v2-nothing-deleted.mjs`
- `.ai/scenarios/maude-v2/{spec.md,baseline/,fidelity/}`
- DDRs from Phase 1 spikes

---

## Validation

1. **Lint / format**: `pnpm lint` (client included after V2-2.2), `pnpm format`
2. **Types**: `cd apps/studio && bunx tsc --noEmit && cd ../.. && bash scripts/check-tsc-coverage.sh`
3. **Rust**: `cd apps/desktop/src-tauri && cargo test && cargo clippy -- -D warnings`
4. **Tests**: `pnpm test`; `cd apps/studio && bun test` (alone; `git status apps/studio/dist/` before and after); hub + cloud suites in their own runs
5. **Build**: `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`; `pnpm --filter @maude/site build`; `pnpm test:e2e:desktop:build`
6. **Desktop e2e**: default, parity, parity:cloud, git, tabs, and every new scenario
7. **Scenario runner** (web-desktop) for browser, cloud tab, viewer
8. **Design**: verifier fidelity screenshots + `/design:critic` per canvas; `design-system-guard`; copy-critic
9. **A11y**: `flow:a11y-auditor`
10. **Security**: `flow:security-auditor` + `flow:ethical-hacker` at Phase 3, wave B and Phase 8
11. **Packaged app**: `check-bundle-completeness.mjs --smoke`, `check-client-boots.mjs`
12. **Nothing deleted**: `node scripts/check-v2-nothing-deleted.mjs`

## Scenario Coverage

| Scenario | Covers | Status |
| --- | --- | --- |
| existing 22 desktop scenarios + multiplayer surface | today's flows, selectors rewritten to v2 | ✅ existing → rewrite |
| `maude-v2/spec.md` | the five key journeys: install → first canvas < 2 min · find a canvas among 93 · ask AI (simple) with 2 sessions · share + comment + Ask to edit · come back to a project (tabs, Home, history) | 🆕 |
| project-tabs, project-tabs-identity, home | Phase 3 | 🆕 |
| modes-present, annotations-stickers, ds-review, export-sheet, share-roles | packages S3, S4, S10, S8, S9 | 🆕 |

Persona: Michal (owner), Tereza (editor, second Mac), Jonas (Can comment, browser). Fixtures: Alligators-scale project (93 canvases in folders incl. junk, Combine-kampan 21 artboards, 247 assets incl. footage + music, its own DS) and Studio site (4 canvases) — unlinked copies only.

## Acceptance Criteria

- [ ] Gate 0 signed by Michal; outcomes folded into CONTRACT.md
- [ ] Phases 1–8 "Done when" all true, each with Progress-log evidence
- [ ] Coverage matrix: 15/15 canvases with evidence + critic ≥ 4.0
- [ ] Nothing-deleted audit 100 %
- [ ] All validation commands green; security 0 blockers; a11y 0 blockers
- [ ] Packaged `.app` from `feat/maude-v2` verified, Michal's test findings closed, PR into `main` ready (rc release after the merge, owner-triggered)
- [ ] DDRs recorded for every Phase 1 spike and every Gate 0 amendment; `kg` plan node closed
- [ ] No regressions in today's flows (characterization tests from V2-0.1 still green, with selectors mapped)

---

## Risks (and the plan's answer)

| Risk | Answer |
| --- | --- |
| Context exhaustion over a program-sized run | Progress log + atomic task IDs; teammates hold detail; lead keeps conclusions only |
| A long branch against a 17k-line `app.jsx` | the split happens first on `main` (Phase 0); only Michal commits to `main`; route modules + lane file ownership on the branch; merge `main` in at phase boundaries if it moves |
| Minified-only / Tauri-only blank-app failures (v0.51.1 class) | v2 landmark in boot gates, packaged-app gate before every rc |
| Testid churn breaks e2e silently | testid contract (V2-0.1), re-emitted ids, tours/spotlights updated in the same change |
| Losing a feature during the reshell | ledger + G0-D + automated nothing-deleted audit as a Phase 4 and Phase 8 gate |
| Floating blur hurts pan/zoom on WebKit | V2-1.8 measurement and fallback before Phase 4 |
| One huge PR / big-bang release / an rc tag rolling the fleet | commits per task id, PR description per phase, Michal's test checkpoints during the run; a `main` build for comparison with today; prerelease channel + split tag globs (V2-2.0) before any rc; stable users stay on 1.x until Michal promotes |
| `/goal` declares victory early | done = `scripts/v2-done.sh` exit 0, not a judgement |
| v1 desktops talking to a v2 hub | hub/cloud changes additive, v1-compatible, released first, tested with a v1 client |
| Parallel test runs fabricate failures / clobber `dist/` | single test lane with a lock; `dist/` rebuilt only by the lead at integration points |
| A mounted-but-dead v2 shell in the minified Tauri build | interactive boot gate (V2-2.12) on every built `.app` |
| Hidden-in-UI but allowed by the server | per-role server enforcement tests; ⌘K shares the visibility predicates (rule 12) |
| A Figma-shaped UI that Claude can't drive | rule 14 + V2-2.4b + S12 + V2-8.16: every capability is a documented file Claude edits or a `maude` verb; the parity test only ratchets down |
| Direct file edits bypass v2 invariants (locks, queue, trash, attribution, element ids) | design-plugin hooks around Claude's file tools + the studio's file watcher (V2-1.11), fail-open only with no studio running |
| v1 and v2 peers corrupt shared files | A17 + V2-1.12 + V2-2.14 + V2-2.18, mixed-peer tests both directions |
| Design-system switching that "works" and renders wrong (name collisions) | A14 schema + `ds-check` collision table + switch only between Conformant systems |
| Stale fidelity evidence | evidence hash-pinned to the canvas file; `v2-done.sh` re-checks hashes |
| Owner-only steps block an autonomous run | G0-E list; the run builds against test modes and stops cleanly at them |
| NEW subsystems with research risk (beat, tracking, semantic diff, DS pinning) | Phase 1 spikes with DDRs; B3 fallback; never block the shell on them |
| Cloud/hub changes affect live cells | release-tag-only fleet rollout (CLAUDE.md); staging cell first |

---

## Progress log

_(the run appends here: `YYYY-MM-DD · V2-x.y · done/blocked · commits · evidence · notes`)_

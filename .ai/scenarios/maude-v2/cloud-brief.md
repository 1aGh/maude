You are a cloud builder for the Maude v2 run (repo 1aGh/maude). You work alone on Linux. Michal's local lead session ("Maude v2") merges your branch later. You cannot message it, so everything it needs must be in your commits and in the hand-off file below.

## Setup
- Branch from `origin/feat/maude-v2` (tip `1b16a10b1` or newer) into a new branch `cloud/s12-w3`. Push only that branch. Never push `feat/maude-v2` or `main`, and never open a PR.
- Read these first, in this order:
  1. `CLAUDE.md`.
  2. `apps/studio/client/v2/contracts/S12-slices.md`. This is your spec, and its §2 decisions D1–D14 are binding.
  3. `.ai/scenarios/maude-v2/agent-routing.md`.
  4. The contracts that `S12-slices.md` names for your slices.
- Open the plan `.ai/plans/feature-maude-v2-redesign.md` only through `grep -n`, never whole.
- Before any structural change, run `kg search "<topic>"` if `kg` is available. If it isn't, write the decision into the hand-off file instead.
- **Already on feat (merged by the lead):** S12.1, S12.2, S12.4, S12.5, S12.6, S12.7, S12.8, S12.9, S12.11. Build on them and don't redo them. Also on feat:
  - all of S5 (the AI chat);
  - S6 (Home, new canvas);
  - S7 (video, with artboard kinds in `client/v2/inspector/kinds/` and the paper table in `kinds/presets.ts` / `kinds/physical.ts`);
  - S8 (import, export, assets, the Generated group);
  - S10 (Design system canvas: `ds status|usage|revisions|check-system`, switch, convert, edges, bring-up `ds-upgrade`, make).

## Your slices (S12-slices.md §3), in this order
All four are markdown or TypeScript with unit tests. None needs macOS, Tauri, WebKit or a real AI provider.

1. **S12.10** `/design:new` + `references/new/*` + the artboards reference (`_guide-28-artboards.md`).
   - Use the kinds and presets that S7 actually shipped. Read `kinds/presets.ts` and `kinds/physical.ts` and run `kg search "S7.21"`.
   - Canvases are created through the `canvas.create` path, so meta and scaffold match the UI.
   - Words ratchet at 0 on `references/new/**`.
2. **S12.12** DS agents + `/design:system` (opus-class: versioned DS formats).
   - New `agents/ds-migrator.md` as a bounded writer.
   - Keeper Pass C reads `ds status` / `ds usage` / `ds check-system --json`, using the §2.3 shapes. Check the real JSON the verbs print today by reading `apps/studio/ds/ds-verb.ts` and `ds/check-system*.ts`.
   - The completeness critic checks the DS-canvas sections and that `tokens.json` ↔ generated CSS is deterministic.
   - `/design:critic --system-only` returns the findings for S10's "Ask AI to review".
   - Migrate goes through `maude design ds convert`, which is S10.12's verb (`kg search "S10.12"`).
3. **S12.3** ACP brief + plugin bootstrap on v2 (opus-class: the system-prompt trust boundary, DDR-054/143/168).
   - Files are `acp/bootstrap-brief.ts`, `acp/plugin-bootstrap.ts` (+ `suppressionFor(plugins)`), at most 15 lines of the `enabledPlugins` part of `acp/bridge.ts`, and the two tests named in the row.
   - The suppression literal is derived from the injection set.
   - Guardrail words must stay absent. A brief that a peer or an untrusted file can influence must never reach the system prompt.
   - Tests use the existing fake ACP harness; no real `claude` process.
4. **S12.14** `/design:assets` + the wave-B command reconcile.
   - New `commands/assets.md` over S8.11's `maude design assets [--usage] [--not-used]` and S8.21's `--usage <asset> --details`.
   - Words-pass residue on `commands/{export,handoff,import,photo,generate,reel,video-analyze}.md` and on the `skills/{ai-generation,video-comp,footage-director,footage-keyframes}/**` that S7/S8 left. Each body names only the verbs its owning package ships today; `cat cli/lib/design-help.gen.mjs` lists them.
   - S12.13 (`asset-describer` / `maude design describe`) is **not** built. Leave every `describe` mention out, mark it `TODO(S12.13)` in the hand-off, and don't build the describe verb yourself.

Skip S12.13, S12.15 and S12.16. They need a real `claude` binary, the agent-journey harness against a live ACP adapter, or every other slice closed first.

## Rules
- Stay inside the "Files owned" column of your slices.
- Never edit these, and never rebuild `apps/studio/dist/` (the lead does that after merging, P4):
  - `http.ts`, `server.ts`, `routes/index.ts`, `app.jsx`
  - the action registry (`apps/studio/actions/**`) and `actions.parity.json`
  - the DDR-115 runtime-state lists
  - `whats-new.json`
- Write what you need in a forbidden file as a **lead patch request** in the hand-off, with the exact hunk.
- Write a fail-first test for every behaviour change. Watch it go red, then green.
- Run only the tests for the files you touch, for example:
  - `node --test cli/lib/<file>.test.mjs`
  - `bun test test/<file>.test.ts` from `apps/studio`
  - `node --test plugins/design/hooks/hooks.test.mjs`
- Run the plugin guards after every slice: `node --test cli/lib/plugin-*.test.mjs`. These are the words ratchet, name namespace and CLI reachability checks.
- Don't run the full studio suite, desktop e2e, Tauri or WebKit. None of them work here.
- Commit per slice with the prefix `S12.<n>:`. Stage specific files, never `git add -A`. Push after every slice so nothing is lost if the session pauses.
- Keep your context small: grep, then read by range. If a slice grows past about 150 turns, commit, push and note it under `## Continue` in the hand-off.

## Hand-off (required)
Keep `.ai/plans/notes/v2-evidence/S12-cloud-w3-handoff.md` up to date and commit it with every slice. It holds:
- per slice: commits, files, tests (red → green), and what's left;
- `## Lead patch requests`: the exact patch for each shared file;
- `## Decisions`: one bullet per structural decision, named `decision:maude/v2-S12.<n>-<slug>` (what, why, alternatives rejected), or `none`;
- `## Continue`: anything unfinished, including every `TODO(S12.13)`.

When you finish or stop, the last commit must be the hand-off.

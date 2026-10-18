# S12 · AI & tooling evolution — slice plan

This is the Phase 6 wave B planning spike for the plan row `.ai/plans/feature-maude-v2-redesign.md` § Phase 6 "S12",
plus § Reuse "S12" and § Gate 0 A13. S12 has no topic canvas of its own. Its checklist is H-ai-parity §4 (all
canvases), as amended by A13 (files are the API, no MCP) and V2-1.18 (topology A).

- **Lane:** L3, after S5 → S6 client.
- **Interfaces it codes against:**
  - `V2-1.11-ai-operability.md`: §5.1 AgentPath, §5.3 verb tiers, §5.5 allow list, §5.7 parity ratchet, §8 "S12";
  - `V2-1.18-agent-topology.md`: §5.2 hand-off, §5.4 hooks, §5.5 agent inventory, §8;
  - `V2-1.3-action-registry.md`;
  - `V2-1.9` §8 (rollback → history restore), `V2-1.10` §8 "S12", `V2-1.13` §8 "S12", `V2-1.17` §5.1/§8;
  - `S8-slices.md` (`apps/studio/describe/` is S8's, built by S8.20; the `assets` verbs come from S8.11).
- **Base:** `feat/maude-v2` @ 2ec48a8b. I read code only and ran nothing except `grep`, `git log`/`show`, `kg search`
  and a manifest tally in python.

## 1. Scope recap

Every design-plugin command, skill, agent and hook moves to v2 concepts and CONTRACT §3–§4 words. On top of that:

- **The generated surfaces:**
  - the AI chat slash list;
  - the `source-command-*` mirrors;
  - the ACP brief.
- **New thin commands:** `/design:history`, `trash`, `comments`, `present`, `open`, `system`, `assets`.
- **Agents:**
  - the agents V2-1.18 keeps (`asset-describer`, `ds-migrator`);
  - the 11 critics reshaped onto `maude.agent-handoff/1` `findings[]`;
  - `_draw-*-rules` moved out of `agents/`.
- **Skills:** the `contract-voice` skill, an `artboards` reference, and the `describe` verb.
- **Agent journeys:** one agent-driven journey per package, in terminal Claude Code and in the AI chat.

The flow plugin stays project-agnostic. It gets only generic knobs; Maude specifics go into this repo's `.ai/` and
`.claude/skills/`.

**Already shipped — do not redo:**

| Piece | Where | By |
| --- | --- | --- |
| Hook dispatcher on 7 events, deny-only, fail-open; `owns` fences; run folder; screenshot gate; bash-guard with the V2-1.18 Q5 narrowings and the §9 Q3 out-of-project redirect deny | `cli/lib/design-hook.mjs`, `bash-guard.mjs`, `hooks.json`, `hooks.test.mjs` (~40 tests) | V2-2.4b, S5.4 |
| `maude.agent-handoff/1` schema + `criticVerdictToHandoff` / `handoffToCriticVerdict` adapter (round-trip test) | `cli/lib/handoff.{mjs,schema.json}`, `handoff-schema.test.mjs` | V2-2.4b |
| Generated `studio-actions` skill, `/design:help` capability block, `maude design help`, both manifests, `--check` drift gate | `scripts/gen-actions.mjs` (+ `gen-actions-docs.mjs`) | V2-2.4b |
| Allow list generated from the auto verbs; `Bash(maude:*)` gone | `acp/bridge.ts` `autoAllowRules()` | V2-2.8 S4 |
| Verbs `check`, `open [--mode]`, `place`, `layout-check`, `history list/show/diff/restore/undo`, `comments list`, `runs`, `exports`, `ds-check`, `ds-upgrade` | `cli/commands/design.mjs`, `apps/studio/bin/*` | V2-2.4b, S1, S5, S8 v1, V2-2.15 |
| Wave-A skill sections: `_guide-27` AI runs; `_guide-17` Present meta; `_guide-editing-v2` (S2.7/S2.11, unmerged); `_guide-05` comment verbs + `comments reply/resolve/reopen/add --as-ai [--findings <file>]` (S9.7b, unmerged); `whiteboard` skill on format 2 | `plugins/design/skills/{design,whiteboard}/` | S2, S3, S4.5, S5.4, S9.7b |
| Edit-safety eval harness (30 tasks, fixtures, graders, prototype hooks) | `apps/studio/test/agent-evals/` (`harness.test.ts` is the committed no-model gate) | V2-1.18 |

S12 reconciles these and never rewrites them. Each wave-A and wave-B package keeps its own verbs and skill
sections (rule 14). S12 owns:
- what nobody owns: commands, agents, `references/`, the ACP brief, generators and journeys;
- the cross-file consistency: SKILL.md pointers, `_guide-08` routing, and the words ratchet.

## 2. Open questions resolved

### 2.1 Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | **V2-1.18 wins over the plan row on agents.** S12 builds `asset-describer` and `ds-migrator` only. It does **not** build `board-reader`, `ds-switcher` or an artboard-drafter. | The plan row predates the V2-1.18 pilot. On that pilot every helper failed the ≤ 1.5× token rule with no quality gain (decision `v2-V2-1.18-agent-topology`). |
| D2 | **Critics keep `Write` in frontmatter**, restricted by the hook, not by the tool list. Every critic is spawned with a hand-off whose `owns` = `[its output under _runs/]`. pre-edit already denies anything else (`out-of-scope`), and an ad-hoc spawn with no hand-off may write only `_*` (V2-1.18 Q6). | A critic must write its `HandoffOut`. Dropping `Write` would move that write into the main agent's context, which costs tokens and loses the SubagentStop validation. The hygiene test asserts "no unrestricted Write" structurally: the body names the hand-off protocol and `maude design check <output>`. |
| D3 | **`_draw-design-rules.md` / `_draw-motion-rules.md` move to `plugins/design/references/draw/{design-rules,motion-rules}.md`**, not to `skills/draw/references/` as V2-1.18 §5.5 wrote it. | `references/edit` and `references/new` already exist and are not loaded as skills. A `skills/draw/` directory with no SKILL.md would be a broken skill. Seven referrers are updated in the same slice. |
| D4 | **Command names stay. `/design:board` is not renamed.** Every description and body moves to v2 words ("annotations", "Preview", "sticky notes", "Stickers"). | Command names are an API (muscle memory, docs, `subagent_type`). The CONTRACT ban on "board" is about meaning *canvas*, and the description shown in the slash list carries the v2 words. An alias would double the list. |
| D5 | **`/design:rollback` stays, rebuilt on Version history**: no flag → `maude design history undo`, `--steps N` / `--list` → `history list` + `history restore <rev>`. `_history/` is read only for pre-v2 snapshots. `/design:history` is the full command. | V2-1.9 §8, with nothing deleted. Two undo systems disagreeing is R-7. |
| D6 | **One S12-owned generator, `scripts/gen-plugin-surfaces.mjs`**, with `--check`. It emits:<br>(a) `client/panels/slash-commands.gen.js` (STATIC_COMMANDS from `commands/*.md` frontmatter `name` / `description` / `argument-hint`, both plugins' design set);<br>(b) every `source-command-*` mirror (design + flow) through `cli/lib/harness/codex-runtime.mjs` `renderCommandSkill`;<br>(c) `skills/contract-voice/SKILL.md` from CONTRACT §3–§4.<br>A node test runs `--check`. | `gen-actions.mjs` is lead-owned registry semantics, so S12 does not extend it. The mirrors are stale today: committed once in a0193828 with no drift gate, and Claude Code loads them as skills, so they teach v1 steps. CONTRACT.md lives in `.design/`, which does not ship. |
| D7 | **The words ratchet is the measured definition of "updated to v2 words".** `cli/lib/plugin-v2-words.test.mjs` counts banned strings per file under `plugins/design/**` (CONTRACT §3 "Not" column where it means UI, "status bar", "Assistant", "⌘⇧A", "Cmd+click", "View → Timeline", "⌘E" as export, raw `curl` to a route that has a verb, `_history/` outside pre-v2 notes, `/_api/ai/start`). Committed counts in `plugins/design/v2-words.ratchet.json` may only go down. They reach 0 at S12.16. | The scout's measured baseline is ~350 hits across ~60 files. Without a ratchet, "words pass" has no done-when. It works like the parity test. |
| D8 | **Hooks stay deny-only.** S5-slices D4 says "Replace / move to the trash asks come from the design plugin's PreToolUse hook answering `ask`", but the shipped `design-hook.mjs` emits only `deny`, and V2-1.11 invariant 1 holds. Permission cards come from Claude Code's own defaults and rules. | P3 and V2-1.11 §5.8.1. The S5.4 code agrees: no `ask` exists on `s5-4`. Flagged to the lead so S5-slices' wording can be corrected. |
| D9 | **Two PostToolUse hooks become one.** The `ds-check --hook` entry folds into `post-edit` as `check --tier fast` warnings (`ds` checker). | V2-1.18 §3 rejected a hook per checker: budget and ordering. Today there are two. |
| D10 | **Flow in the AI chat stays off.** Flow agents and skills get only generic, config-driven knobs: a new `security.projectChecklist` path, and "drive the product through its CLI where one exists" in `scenario-runner` / `agent-browser`. Maude's v2 checklist (tier, minRole, canvas-safe, tool-result poisoning) goes to `.ai/security/v2-actions-checklist.md`, and v2 testids go to `.claude/skills/desktop-e2e`. | CLAUDE.md: flow is project-agnostic. H §4.1's flow rows were Maude-specific. |
| D11 | **Panel-navigating `human:view-pref` rows get the `maude design open --panel <id>` path.** The rows are: `view.trash`, `view.design-system`, `view.layers-panel`, `view.layers`, `view.inspector`, `settings.open`, `help.shortcuts`, `help.whats-new`. `diag.logs` goes to S11's `logs` verb instead. `humanMax` goes down by up to 8, and only down. | V2-1.11 §5.1 rule: "UI-only actions with effect none use `maude design open` when they navigate (… a panel)". The measured tally is 98 human rows, 52 of them `view-pref`, and these 8 open a panel or sheet. |
| D12 | **Critic findings become AI comments only on an explicit `/design:critic`**, as one batched `comments add --as-ai --findings <file>` per round (shared → one prompt, V2-1.11 Q1). The auto-critic loop inside `/design:edit` and `/design:new` never posts comments. | A13: "critic findings land as attributed comments". Posting every loop iteration would spam the thread and the prompts. |
| D13 | **The `contract-voice` skill applies to the AI's own messages in the AI chat panel and to text Claude writes into Maude UI fields** (comment text, version names, chat titles, run results). It does not apply to the user's canvases. `copy-critic` loads it only when the canvas's design system is `maude-v2`. | CONTRACT voice is Maude's product voice. A downstream project keeps its own voice (H §4.1 copy-critic row). |
| D14 | **Journeys are model-driven evidence, not CI.** They live in `apps/studio/test/agent-journeys/` and reuse `agent-evals/lib` (fixtures, graders, `claude -p --plugin-dir`). They have two lanes: terminal (`claude -p --plugin-dir plugins/design`) and AI chat (the adapter driven with `acp/bridge.ts`'s exported `newSessionParams` + `MAUDE_DEFAULT_ALLOWED_TOOLS` + the injected plugins). Grading is deterministic (bytes, history entry author AI, trash row, comment `authorKind`), never a model judge (V2-1.18 finding). The deterministic UI ≡ verb contract tests stay with each package, in CI. | They cost real model usage, as the agent evals do. The full eval re-run stays at V2-8.16. |

### 2.2 Open questions (recommended default in bold)

- **Q1 — `maude design describe` tier.** The verb spends the person's Claude usage and reads only temp-dir pictures.
  **Default: `prompt` (`external`).** The desktop index service spawns it on consent, not the model. Lowering it
  needs a decision.
- **Q2 — Declarative `draw-build --spec <json>` as an auto verb** (V2-1.11 Q2). **Default: not in S12**; the draw
  loop keeps prompting. This is a follow-up if `/design:draw` journeys show prompt fatigue.
- **Q3 — Cut-down topology eval re-run with the real plugin before the S12 close.** It costs about 10 tasks × A × 1
  trial of model usage. **Default: lead's call at S12.16.** Otherwise `harness.test.ts` + `hooks.test.mjs` green is
  the gate, and the full run stays at V2-8.16.

### 2.3 Cross-lane splits (agreed by message; none needs a new contract file)

- **S10 ↔ S12 (`/design:setup-ds`):**
  - **S10 owns** what the DS flow *produces*: `commands/setup-ds.md`, `skills/design-system/**`, the Design system
    canvas output, `tokens.json` + CSS, several systems, `--upgrade-schema`, the `ds switch|update|review|migrate`
    verbs with their skill sections.
  - **S12 owns** `ds-migrator`, the keeper / completeness / brand-critic reshape onto the DS-canvas model, the thin
    `/design:system`, and a final words pass on `setup-ds.md` once S10 merges.
  - S12 never edits `skills/design-system/**` while S10 runs.
  - Agreed by plan-s10, recorded in `S10-slices.md` Q13 on spike-S10 @ bc48ea03. The interface is S10 §2.4's
    `--json` shapes, with goldens in `test/ds-verb-json.test.ts` (S10.3):

    | Verb | Shape |
    | --- | --- |
    | `ds status` (doubles as the review read) | `maude.ds-state/1` |
    | `ds publish` / `update` | `maude.ds-review/1` |
    | `ds switch` | `maude.ds-switch-review/1` |
    | `ds convert` / `migrate` | `maude.ds-convert/1` |
    | `ds usage` | `maude.ds-usage/1` (+ `elements[]`) |
    | `ds check-system` | `maude.ds-system-check/1` |
    | `ds revisions` | `maude.ds-revisions/1` |
    | `ds library` | `maude.ds-library/1` |
    | `ds keep` / `undo` / `pick` / `pending` / `canvas` / `make` / `draft` / `use` / `mix` / `trash` / `restore` | `maude.ds-result/1` |
    | `ds-check` (existing) | `maude.ds-check-report/1` |
    | `ds-upgrade` (existing) | `maude.ds-upgrade-plan/1` + `review.json` |

    "Ask AI to review" in Check the system starts `/design:critic --system-only` and reads S12.12's keeper and
    completeness findings.
- **S7 ↔ S12** (agreed by plan-s7, `S7-slices.md` §2.2 on spike-S7 @ f5f3b385):
  - **S7 owns** `skills/video-comp/**`, `skills/footage-director/**` and `commands/reel.md` text for its features:
    S7.2 `transcribe-local`, S7.3 `beats`, S7.5 Captions/Duck/Reframe/Place + lint, S7.6 clip verbs, S7.14
    `reel-place --next` + beat-grid shot lengths, S7.18 tracks + the video cap.
  - **S12 owns** the `footage-director` and `footage-analyst` agent envelopes, the artboard-kinds reference, and a
    final words pass. The words pass also covers S7's new `<Place at formats>` comp component.
- **S8 ↔ S12** (agreed by plan-s8, recorded in `S8-slices.md` @ eccbec6f on spike-S8):
  - **S8 owns** `export` / `handoff` / `import` / `photo` / `generate` commands and `skills/ai-generation/**` text,
    plus `apps/studio/describe/` (S8.20: consent, batching, budget, validation) and the `assets` verbs (S8.11).
  - **S12 owns** the `asset-describer` agent + `maude design describe` (calls into `describe/`), the
    `media-generation-director` envelope, and `/design:assets` over `maude design assets [--usage <rel>] [--not-used]`.
- **S11 ↔ S12:** `logs`, `sync status|resync`, `canvas-errors`, `canvas-source` are S11's verbs and skill rows
  (S11-slices §3). S12 only routes to them in `_guide-08`.
- **S1 / S3 / S9:** S12 consumes `history`/`trash` (S1.17), `open --mode present --link` (S3.7b) and
  `comments reply|resolve|reopen|add --as-ai` (S9.7b). It never edits their bins.

## 3. Slices

**Lead patch requests used below:**
- **(P1)** registry `agent` rows plus a `gen-actions` regen of both manifests;
- **(P2)** `actions.parity.json` `humanMax` lowered (never raised);
- **(P3)** the `cli/commands/design.mjs` verb list + `plugin-cli-reachability` whitelist for a new verb;
- **(P4)** a `dist/` rebuild after a `client/**` change;
- **(P5)** a `dgn`/shell message: `ui-open` `panel` field.

No slice touches the four DDR-115 lists: `_runs/` is already classified.

| id | Title | Artboards | Files owned | Lead patches | Model | Deps | Done-when | Red-first tests | e2e / scenario | Turns |
|---|---|---|---|---|---|---|---|---|---|---|
| **S12.1** | Ratchets first: v2 words + agent hygiene | — | new `cli/lib/plugin-v2-words.test.mjs`, `plugins/design/v2-words.ratchet.json`, extended `cli/lib/plugin-name-namespace.test.mjs` (hygiene) | — | sonnet | — | Ratchet committed at today's per-file counts. Hygiene asserts (V2-1.18 §7): no `_*.md` in `agents/`; critics name the hand-off protocol; untrusted-content readers (`footage-analyst`, `reconstruct-*`, `asset-describer`) have no `Bash`/`Web*`; bounded-writer descriptions say "never auto-delegated"; total agent-description tokens ≤ today's + 10 %. Each later slice lowers the ratchet for its files. | hygiene red today on `_draw-*-rules` (allow-listed until S12.5); ratchet raising a count fails (planted) | — | 60 |
| **S12.2** | Plugin-surfaces generator: slash list, mirrors, contract-voice | — | new `scripts/gen-plugin-surfaces.mjs`, `client/panels/slash-commands.gen.js`, `client/panels/slash-commands.js` (imports the gen), `plugins/*/skills/source-command-*/**` (regenerated), new `plugins/design/skills/contract-voice/SKILL.md` (gen §3–§4 + hand-written AI-message rules, D13), new `cli/lib/plugin-surfaces.test.mjs` | P4 | sonnet | S12.1 | `--check` green. The slash list holds all 24+ design commands, including board/generate/photo/reel/import/video-analyze/chat/hub-workspace, which are missing today. Mirrors byte-equal the renderer. The contract-voice body equals CONTRACT §3–§4. | `slash-commands.test.ts`: every `commands/*.md` appears (red: 8 missing); `plugin-surfaces.test.mjs` `--check` red on the stale mirrors | — | 90 |
| **S12.3** | ACP brief + plugin bootstrap on v2 | — | `acp/bootstrap-brief.ts`, `acp/plugin-bootstrap.ts` (+ `suppressionFor(plugins)`), the `enabledPlugins` lines of `acp/bridge.ts` (≤ 15 lines, after S5's bridge slices merge), `test/acp-bootstrap-brief.test.ts`, `test/acp-session-plugins.test.ts` | — | **opus** (system-prompt trust boundary, DDR-054/143/168) | S12.2, S5 merged | The brief says "AI chat panel", names `maude design open/check/history/trash/comments` and the `contract-voice` / `studio-actions` skills, and states "annotations" (not board), one AI per artboard and moved-to-the-trash as capability facts. No "Assistant". Guardrail words still absent. The suppression literal is derived from the injection set, so a fourth injected plugin is suppressed with no edit. | brief test: "Assistant" absent, the v2 nouns present (red today); suppression test with a planted 4th plugin (red: hand literal) | journey lane "AI chat" (S12.15) boots with it | 70 |
| **S12.4** | One PostToolUse dispatcher (D9) | — | `cli/lib/design-hook.mjs` (post-edit runs the `ds` checker as warnings), `plugins/design/hooks/hooks.json` (drop the `ds-check --hook` entry), `plugins/design/hooks/hooks.test.mjs` | — | **opus** (edit-safety harness) | — | One PostToolUse command per matcher. `ds` S-rule warnings arrive as `additionalContext` inside `post-edit`, within the 1.5 s p95 budget (`check-tier-budget`). Behaviour is otherwise unchanged. `agent-evals/harness.test.ts` green. | hooks.test: two PostToolUse entries → red; a planted S-rule literal yields the warning through `post-edit` | — | 60 |
| **S12.5** | Critic protocol: design-critic, `/design:critic`, the loop | — | `agents/design-critic.md`, `commands/critic.md`, `skills/design/_guide-09/10/11/13/15*.md`, `agents/signature-moment-critic.md` (aspiration → `result`) | P1 if `/design:critic` gains an action row | **opus** (agent semantics, loop) | S12.1, S9.7b merged | The pipeline is: deterministic checks → render → keeper → ≤ 3 critics routed by `_guide-09`. The main agent writes `handoff/<agent>-<n>.in.json`, and each critic writes `HandoffOut` and runs `maude design check <output>`. The main agent applies the fixes. An explicit `/design:critic` posts one `comments add --as-ai --findings` batch (D12). `handoffToCriticVerdict` feeds the stop rules unchanged. | hooks.test: a critic with a hand-off writing a canvas → `out-of-scope` (new case); `handoff-schema.test.mjs` with a design-critic sample out-file; ratchet down | `/design:critic` journey (S12.15) | 120 |
| **S12.6** | The other 10 critics on the protocol | — | `agents/{a11y,brand,copy,frontend,graphic-design,info-architecture,motion,typography,draw}-critic.md` (+ `reconstruct-critic` envelope only; tools unchanged) | — | sonnet | S12.5 | Every critic has the same "Hand-off" section as design-critic (one shared include text pinned by the hygiene test). `copy-critic` loads `contract-voice` only for `maude-v2` canvases (D13). Ratchet 0 on these files. | hygiene: each critic names `maude.agent-handoff/1` (red on 10) | — | 100 |
| **S12.7** | Bounded writers + readers on hand-offs; `_draw` rules move | — | `agents/{draw-agent,footage-director,reconstruct-agent,footage-analyst,media-generation-director,ux-research-agent}.md`, move `_draw-*-rules.md` → `references/draw/` (D3) + referrers `commands/{draw,to-lottie,to-rn}.md`, `agents/draw-critic.md`, `_guide-09`, `CATEGORIES.md` | — | **opus** (untrusted-input sandboxes, DDR-174/183) | S12.5 | Writers' `owns` name only the NEW file (SVG, `.edl.json`, reconstructed canvas). Readers stay `Read`-only. Descriptions say "spawned only by …; never auto-delegated". Nothing remains under `agents/_*.md`. | hygiene `_*.md` red → green; hooks.test: draw-agent editing an existing canvas → denied (bounded writer, NEW files only) | `/design:draw` in S12.15 | 110 |
| **S12.8** | v2 commands: history, trash, comments, present, open; rollback rebuilt; routing | — | new `commands/{history,trash,comments,present,open}.md`, `commands/rollback.md` (D5), `skills/design/_guide-08-command-routing.md` (routing rows + the V2-1.18 §4 delegation rule), `skills/design/SKILL.md` pointer lines (`_guide-editing-v2`, `_guide-27`, new guides), `skills/design/_guide-07-snapshot-protocol.md` (→ hooks' `snap/`/`base/` + Version history), `cli/lib/design-open.mjs` (`--panel <id>`, D11) | P1 (8 rows → cli `open --panel`), P2 (`humanMax` −8), P3, P5 | sonnet | S1.17, S3.7b, S9.7b merged | Each new command is ≤ 120 lines and routes through verbs only (no route `curl`). `/design:comments` runs read → edit → reply + resolve, one run = one version. `/design:open` covers canvas, `#artboard`, `@element`, `--mode`, `--panel`. Parity green with `humanMax` lowered. | `maude-design-open.test.ts` `--panel trash` with an attached shell selects it, exit 3 without one (red: no flag); ai-parity-coverage with the lowered cap; reachability: no `curl` in the new commands | `/design:comments` + `/design:rollback` journeys | 130 |
| **S12.9** | `/design:edit` + `references/edit/*` on v2 | — | `commands/edit.md`, `references/edit/**` (25 files) | — | sonnet | S12.5, S12.8 | Step 4.5's raw `curl /_api/ai/start` is gone; the hooks' run bracket and the run-folder line replace it. The snapshot step moves to hooks + Version history. Ids are kept (V2-1.4), locks and the waiting line are respected, and the `artboard-busy` / `soft-locked` deny text is explained. "Tell user" follows `contract-voice`. Tips are rewritten (no status bar, no Cmd+click; the v2 select model). The words ratchet is 0 on `references/edit/**`. | reachability extended: plugin markdown has no `curl` to a route that has a verb (red: step 4.5) | `/design:edit` journey | 130 |
| **S12.10** | `/design:new` + `references/new/*` + artboards reference | — | `commands/new.md`, `references/new/**` (30 files), new `skills/design/_guide-28-artboards.md` (kinds App · Web page · Social · Print · Video · Fixed size, presets from S7's catalogue, "Untitled canvas" C4, default DS + folder inheritance A12), `skills/ui-kit/SKILL.md` | — | sonnet | S12.9, S6.1, S7 kinds slice merged | Canvases are created through the verb / `canvas.create` path, so meta and scaffold match the UI. AI drafts artboard by artboard (S5 run stages). The words ratchet is 0 on `references/new/**` + ui-kit. | reachability: no hand-rolled `.meta.json` scaffolding in `references/new` (grep pin, red) | `/design:new` journey | 120 |
| **S12.11** | Words pass: the remaining commands + design guides | — | `commands/{board,browse,chat,screenshot,smoke,init,setup-docs,hub-workspace,critic?,draw,to-lottie,to-rn}.md` (critic only if S12.5 left residue), `skills/design/_guide-00/02/04/05(rest)/06/24/25/26*.md`, `skills/self-host/**`, `skills/whiteboard/**` words only (S4.5 owns format) | — | sonnet | S12.8 | `/design:board` uses annotations v2 words (D4). `/design:chat` = open in the AI chat panel + attach (print `claude --resume <id>` for an in-app chat, B8; no "Assistant / ⌘⇧A"). `browse` / `screenshot` / `smoke` `--studio` use v2 landmarks/testids. `init` / `setup-docs`: a project with no canvases is valid (05); INDEX lists DS canvases pinned + folders. `hub-workspace` / `self-host`: roles Can view · Can comment · Can edit · Owner. Ratchet 0 on these files. | ratchet only | — | 120 |
| **S12.12** | DS agents + `/design:system` | — | new `agents/ds-migrator.md` (bounded writer: owns = the new Design system canvas + a review, V2-1.6/1.13), `agents/{design-system-keeper,design-system-completeness-critic,brand-critic}.md` (read the DS-canvas model, usage index, per-canvas `dsRev`; brand section = canonical mark source, DDR-141 path change), new `commands/system.md`, final words pass on `commands/setup-ds.md` | P1 if `/design:system` adds rows | **opus** (versioned DS formats, migrator semantics) | S10 merged (verbs + DS canvas), S12.7 | `/design:system` covers set default, switch (propose; apply = the "Update N canvases" card), review outside changes, migrate `system/<ds>/` via ds-migrator, import tokens. Keeper Pass C reads `ds status` / `ds usage` / `ds check-system` `--json` (§2.3 shapes). `/design:critic --system-only` returns their findings for S10's "Ask AI to review". Completeness checks DS-canvas sections and `tokens.json` ↔ generated-CSS determinism. | keeper on a fixture with a left-out canvas (old `dsRev`) → not drift (red); ds-migrator writing an existing canvas → denied | `/design:system` journey | 130 |
| **S12.13** | `asset-describer` + `maude design describe` | — | new `agents/asset-describer.md` (Read only, offline, cwd = OS temp dir of ≤ 1024 px JPEGs, V2-1.17 §5.1), new `apps/studio/bin/describe.sh` + `_describe.mjs` (calls S8's `describe/` service; spawns the bundled `claude -p` with `--agents` restricted), `test/describe-verb.test.ts` | P1, P3 (tier `prompt`, Q1) | **opus** (untrusted pictures, headless spawn, DDR-177 bundle completeness) | S8.20 merged | Results validate (caption ≤ 140, ≤ 12 tags, text ≤ 280, results for a sha outside the batch dropped). No project path ever reaches the agent. `check-bundle-completeness --smoke` covers the verb. | planted out-of-batch sha / control chars dropped (red: no verb); spawn args carry no `Bash`/`Write`/MCP | — | 130 |
| **S12.14** | `/design:assets` + wave-B command reconcile | — | new `commands/assets.md` (over S8.11 `assets [--usage] [--not-used]` + `describe`), words-pass residue on `commands/{export,handoff,import,photo,generate,reel,video-analyze}.md` and `skills/{ai-generation,video-comp,footage-director,footage-keyframes}/**` after S7/S8 merge | — | sonnet | S7, S8 merged, S12.13 | Ratchet 0 on these files. Each command's body names the owning package's verbs only. | ratchet only | `/design:assets` journey | 110 |
| **S12.15** | Agent-journey harness + wave-A journeys | — | new `apps/studio/test/agent-journeys/{run.mjs,lanes/terminal.mjs,lanes/acp.mjs,graders.mjs,journeys/S1..S5,S9.json,README.md}`, evidence `.ai/plans/notes/v2-evidence/S12-journeys/` | — | **opus** (ACP adapter + permission model) | S12.3, S12.5, S12.8, S12.9 | Both lanes run the same journey JSON. Journeys:<br>S1: new canvas → rename → restore a version → move to the trash → restore;<br>S2: id-safe edit + link;<br>S3: Present order/notes + `open --mode present`;<br>S4: annotate a sticky + sticker + resolve;<br>S5: one run = one undo step, busy artboard denied;<br>S9: implement 2 comments → reply + resolve.<br>Graded deterministically, with a `--dry` self-test that needs no model. | `run.mjs --dry` grader self-test with planted faults (each grader red once) | the journeys themselves | 140 |
| **S12.16** | Wave-B journeys + S12 close-out | — | `agent-journeys/journeys/S6,S7,S8,S10,S11.json`, flow knobs (D10: `plugins/flow/.claude-plugin/config.schema.json` `security.projectChecklist`, `agents/{security-auditor,ethical-hacker,scenario-runner}.md`, `skills/agent-browser` generic CLI-first line), `.ai/security/v2-actions-checklist.md`, `.claude/skills/desktop-e2e` v2 testids, `v2-words.ratchet.json` → all 0 | P2 if any further human row gained a path | sonnet | everything above, wave B merged | Ratchet all 0. Every package has a green journey in both lanes. Parity: `pendingMax` 0, `humanMax` ≤ the lowered value. `agent-evals/harness.test.ts` + `hooks.test.mjs` green. Q3 run if the lead approves it. Ledger `S12` package row is verified with this evidence. | flow schema test: an unknown `security` key is still rejected, and `projectChecklist` is accepted (red) | the journeys | 100 |

## 4. Ledger coverage check

- **Artboard rows with `package` = S12: none.** The ledger has 360 artboard rows. Their `package` values are S1–S11
  combinations; no artboard row names S12. S12 makes no artboard verifiable alone.
- **Rule rows (kind `rule`):** all 34 rows are claimed for their UI by S1/S2/S3/S4/S5/S9/S11 (grep across
  `S*-slices.md`). S12 adds the agent-side evidence, not the row's close, for:
  - `00/rule/ai-describes-the-result` — S5.9 closes it; the brief and `contract-voice` wording is S12.2/S12.3 (as
    S5-slices §4 says);
  - `00/rule/no-we-no-i` — S11 closes it; the AI-message half is `contract-voice` (S12.2) and the journeys' result
    lines are graded for "I"/"we" (S12.15);
  - `00/rule/one-ai-per-artboard` — S5 closes it; S12.15's S5 journey proves the deny through the agent path;
  - `00/rule/moved-to-the-trash` — S1/S9 close it; S12.15's S1 journey proves the trash path through the verb.
- **Home rows (kind `home`, G0-D/D1–D20):** none is S12's. D9's "Implement N comments" chat door gets its agent half
  in `/design:comments` (S12.8). That is the AI path, and the row stays S5's.
- **Package row `S12`:** closed by S12.16.
- **Tasks fed:** V2-8.15 (docs for people and agents) reads S12's commands and skills. V2-8.16 (parity 100 % +
  full eval) re-runs S12.15/16's journeys and the eval with the real plugin.

## 5. Risks and run order

**Risks:**
- **R1 Shared plugin files with wave-B owners.** `_guide-08`, `SKILL.md` and the generated help are touched by many
  packages. Mitigations:
  - generated outputs are never hand-edited;
  - `_guide-08` and `SKILL.md` belong to S12.8 alone;
  - other packages send S12 a one-line pointer patch instead of editing them.
- **R2 `bridge.ts` collides with S5** (s5-9, s5-10 edit it). S12.3 waits for S5 to merge and touches only the
  `enabledPlugins` lines.
- **R3 Critic reshape breaks the auto-fix loop.** S12.5 keeps `handoffToCriticVerdict` as the loop's input, so the
  stop rules read the same fields. S12.6 does not start until S12.5's `/design:critic` journey and a manual
  `/design:edit` loop pass.
- **R4 Words ratchet false positives** ("dashboard", "keyboard" contain "board"). The S12.1 matcher uses
  word-boundary and phrase rules plus per-file allow entries with a reason; it never makes a blanket exception.
- **R5 Journey cost and flakiness.** Not CI (D14). Graders are deterministic; one retry is allowed on an infra
  failure (adapter boot), never on a grade.
- **R6 Sizing.** The two reference slices (S12.9, S12.10) are mostly prose. A builder over 150 turns commits per
  sub-folder and hands back with `## Continue`.

**Run order (parallel worktrees never share a file):**

```
W1 (now):         S12.1 → S12.2          ∥ S12.4
W2 (after S5):    S12.3                  ∥ S12.5 → S12.6
W3:               S12.7                  ∥ S12.8 (needs S1.17, S3.7b, S9.7b merged)
W4:               S12.9 → S12.10 (needs S6.1, S7 kinds)   ∥ S12.11
W5 (wave B in):   S12.12 (S10)  ∥ S12.13 (S8.20) → S12.14 (S7, S8)
W6:               S12.15 (can start after W3; journeys added as deps land) → S12.16
```

Opus: S12.3, .4, .5, .7, .12, .13, .15. Sonnet: S12.1, .2, .6, .8, .9, .10, .11, .14, .16.

## Appendix — item map (design + flow plugin, 2026-10-18)

Hits = banned-string count found by the inventory scout. Each row gives v2 concept and words → owning slice.

| Item | v2 change | Slice |
| --- | --- | --- |
| cmd `board` (31 board, 7 `_history/`) | annotations v2 words, `annotate --ops`, D4 | S12.11 (S4.5 owns format) |
| cmd `browse` (Cmd+click 2, Inspector 4, status bar 1) | v2 shell words, optional `open` | S12.11 |
| cmd `chat` (Assistant 3, ⌘⇧A, `/_api/` 3) | AI chat panel + attach (B8) | S12.11 |
| cmd `critic` (verdict 13, `_history/` 8) | hand-off pipeline, ≤ 3 critics, findings → AI comments | S12.5 |
| cmd `draw` | `references/draw/`, draw-agent envelope | S12.7 |
| cmd `edit` + `references/edit` (25 files: ai/start, curl 4, status bar, Cmd+click) | run bracket via hooks, Version history, ids, locks | S12.9 |
| cmd `export` (⌘E, `/_api/`) · `handoff` · `import` · `photo` · `generate` | S8 owns text; S12 residue | S8 → S12.14 |
| cmd `help` (generated) | unchanged generator; command list from frontmatter | gen-actions (lead) |
| cmd `hub-workspace`, skill `self-host` | roles words, capability report | S12.11 |
| cmd `init`, `setup-docs` (`_history/` 7, Assistant) | no-canvas project valid; INDEX with DS + folders | S12.11 |
| cmd `new` + `references/new` (30 files) | canvas.create path, artboard-by-artboard, kinds/presets | S12.10 |
| cmd `reel`, `video-analyze` (`/_api/` 10, View → Timeline) | S7 owns text; S12 residue | S7 → S12.14 |
| cmd `rollback` (`_history/` 5) | on `history undo/restore` (D5) | S12.8 |
| cmd `screenshot`, `smoke` | v2 landmarks/testids for `--studio` | S12.11 |
| cmd `setup-ds` | S10 owns; S12 final words | S10 → S12.12 |
| cmd `to-lottie`, `to-rn` | `references/draw/` path | S12.7 |
| new cmds `history`, `trash`, `comments`, `present`, `open` | thin over S1/S3/S9 verbs | S12.8 |
| new cmds `system`, `assets` | thin over S10/S8 verbs | S12.12, S12.14 |
| 11 critics (`Write` + verdict) | `HandoffOut.findings[]`, hook-restricted `Write` (D2) | S12.5, S12.6 |
| `design-system-keeper` (sidebar 8, Inspector 3, status bar) · `-completeness-critic` · `brand-critic` | DS-canvas model, usage index, `dsRev` | S12.12 |
| `draw-agent`, `footage-director` (raw curl 1), `reconstruct-agent` | bounded writers of NEW files | S12.7 |
| `footage-analyst`, `reconstruct-critic`, `media-generation-director`, `ux-research-agent` | envelope only; tools unchanged | S12.7 |
| `_draw-design-rules`, `_draw-motion-rules` | → `references/draw/` (D3) | S12.7 |
| new `asset-describer`, `ds-migrator` | V2-1.17 / V2-1.13 | S12.13, S12.12 |
| not built: `board-reader`, `ds-switcher`, artboard-drafter | D1 | — |
| skill `design` guides 00–27 | 07/08/SKILL → S12.8; 09/10/11/13/15 → S12.5; rest → S12.11; 17/27/editing-v2/05-verbs stay with S3/S5/S2/S9 | split |
| skill `design-system` (AskUserQuestion 38, curl 3) | S10 | S10 |
| skill `whiteboard` | S4.5 format; S12 words | S12.11 |
| skills `ai-generation`, `video-comp`, `footage-director`, `footage-keyframes` | S7/S8 text; S12 residue | S12.14 |
| skill `ui-kit` (Inspector 2) | artboard kinds + presets | S12.10 |
| skill `studio-actions` (generated) | unchanged generator | lead |
| new skill `contract-voice` | generated §3–§4 + AI-message rules | S12.2 |
| `source-command-*` mirrors (26 design + flow, stale since a0193828) | generated + drift-gated (D6) | S12.2 |
| `hooks.json` (2 PostToolUse) | one dispatcher (D9) | S12.4 |
| ACP `bootstrap-brief.ts`, `plugin-bootstrap.ts`, `bridge.ts` enabledPlugins | v2 words, derived suppression | S12.3 |
| `client/panels/slash-commands.js` (16 of 24 commands) | generated list | S12.2 |
| flow `security-auditor`, `ethical-hacker`, `scenario-runner`, skill `agent-browser`, `scenario`, `a11y-*`, `design-system-guard` | generic knobs only; Maude specifics in `.ai/` + `.claude/skills` (D10) | S12.16 |
| flow debate seats, `test-coverage`, other flow commands | no v2 change (dev workflow, not in the AI chat) | — |

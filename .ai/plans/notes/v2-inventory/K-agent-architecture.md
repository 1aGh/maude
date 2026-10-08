# K — Agent architecture for Maude v2: one writer, specialist readers, files as the API

> Research note for `.ai/plans/feature-maude-v2-redesign.md` (Gate 0 A13, V2-1.11, V2-2.4b, S12, V2-8.16).
> Question: for an AI that edits a structured design document stored as local files, should Maude v2 use one general agent with good skills, or specialized sub-agents (artboard/layout, annotations/whiteboard, design system, video/timeline, critics)? And should agents change the document by editing files directly or by calling tools?
> Date: 2026-10-08. Sources at the end. Repo facts were read from the working tree and the kg graph (read-only).

---

## TL;DR

1. **One writer per run, with skills, and specialist sub-agents only as readers, verifiers, or writers of separate files.** The main AI chat agent, which loads the `design` skill and its siblings, owns the conversation and every edit to a canvas the user is iterating on. Sub-agents are justified by three things only:
   - **context isolation for read-heavy work**: big boards, footage, picture descriptions, research;
   - **independent verification**: critics and the keeper, in a fresh context, read-only;
   - **parallel writes to separate files under a contract**: draw-agent writes a new SVG, a design-system switch fans out with one canvas file per worker, ds-migrator writes the Design system canvas.

   The evidence is consistent: multi-agent setups pay off for breadth-first reading and cost about 15× the tokens. They degrade sequential work by 39–70%, and parallel writers clash on implicit decisions.
2. **Artboard/layout and annotations stay skills, not agents.** Layout and annotation edits share context with the user's intent and with the same file. Splitting them creates the "Flappy Bird" failure. Add a read-only `board-reader` sub-agent for large or untrusted boards, not a writing annotations agent.
3. **Agents to add or reshape:**
   - `asset-describer`: new; read-only, no network access, batched.
   - `ds-migrator`: new; bounded writer, deterministic mapping first, emits a review.
   - `ds-switcher`: worker in a per-canvas fan-out, writes proposals only.
   - `board-reader`: new; read-only.
   - Critics: lose the `Write` tool, or keep it hook-restricted to `_runs/`.
   - `_draw-*-rules`: move out of `agents/`.
   - `footage-analyst`/`footage-director`, `draw-agent`/`draw-critic` and `reconstruct-*` already have the right shape. Keep them.
4. **Keep "files are the API", and make it safe with a strict layered harness rather than a tool layer:**
   1. a versioned JSON Schema or convention doc for every file;
   2. one `maude design check <file>` validator verb with actionable errors;
   3. hooks: PreToolUse `edit.check`, PostToolUse `edit.touched` + `check` that feeds errors back, Stop/SubagentStop gates that require green checks and screenshot evidence;
   4. a run bracket, so one AI run is one undo step;
   5. a render-and-screenshot check per touched artboard.

   This mirrors what made code agents reliable: SWE-agent's lint-on-edit guardrail (+3.0 pp, 18.0 vs 15.0), v0's AutoFix and linter pass, and "give Claude a check it can run".
5. **One nuance to A13 for annotations.** The file stays the readable format and the read path. The preferred write path for co-edited boards is the existing `maude design annotate --ops` verb (`apps/studio/annotations/ai-write.ts`), because it validates against the registry, stamps `author:{kind:'ai'}` and carries `expect` for per-element merge with concurrent human edits. Direct `Edit` of `.annotations.json` stays allowed, gated by the PostToolUse validator. That is still "files are the API" (the verb writes the same file) and needs no MCP.
6. **Decide by evals, not taste.** Add spike **V2-1.18 "Agent topology + edit-safety harness"** with a 30-task eval on fixture canvases. It compares architecture A (single writer + skills) against B (A + candidate specialist sub-agents) on pass^3 of invariants, quality rubric, tokens and latency. The plan (§3) adds work packages and red-first tests.
7. **Hard constraint discovered: the in-app AI chat cannot use agent teams.** ACP runs `claude-agent-acp` → `claude -p` (`apps/studio/acp/bridge.ts:4`), and Claude Code doesn't spawn teammates in non-interactive or Agent SDK sessions. Product architecture must therefore rely on sub-agents and skills. Agent teams stay a tool for building Maude (the v2 run), and for terminal users only as an optional extra. This matches DDR-130's "reduce tier for everyone, relay only with teams".

---

## 0. What Maude has today (repo context)

- **Design agents (23 files in `plugins/design/agents/`):**
  - 11 critics: `design-critic` (default, inline 7-layer walk, JSON verdict), `a11y`, `brand`, `copy`, `frontend`, `graphic-design`, `info-architecture`, `motion`, `typography`, `signature-moment`, `design-system-completeness`.
  - `design-system-keeper`: read-only audit between generation and critics.
  - `draw-agent` + `draw-critic`: geometry-engine SVG writer with a self-verify loop, plus an independent rubric judge.
  - `footage-analyst` (`tools: Read` only, fanned out per clip) and `footage-director` (writes the EDL JSON).
  - `reconstruct-agent` / `reconstruct-critic`: Bash-free, for an untrusted image (DDR-174).
  - `media-generation-director`: read-only proposer.
  - `ux-research-agent`: WebSearch; the classic research sub-agent.
  - `_draw-design-rules`, `_draw-motion-rules`: rule files that the runtime registers as agent types. H-ai-parity §1.3 flags this as a naming-hygiene issue.
- **Design skills:**
  - `design`: 27 staged guides, including routing, snapshot, critic loop and stop conditions.
  - `design-system`, `whiteboard`, `video-comp`, `footage-director`, `footage-keyframes`, `ai-generation`, `ui-kit`, `self-host`.
  - 24 `source-command-*` mirrors of the slash commands.
- **Annotations are already a schema-first, agent-ready format:**
  - `apps/studio/annotations/schema.ts` (DDR-242) defines a canonical `{"format":"maude.annotations","v":2,"elements":[…]}` with **one element per line in a deterministic order**. "The same board is the same bytes on every machine and a git diff shows exactly which element changed."
  - Validation is total per element: a bad element is **dropped and reported**, never the whole board.
  - `ai-write.ts` speaks world coordinates and element ids, emits the same `put | patch | delete` ops as the canvas, stamps `author: {kind:'ai'}`, and carries `expect` for merge.
  - `lock.ts` is a UX guard, not a permission.
  - `canvas-rects` gives a world-coordinate geometry manifest, so agents never hand-compute coordinates.
- **Hooks today:** `plugins/design/hooks/hooks.json` has only a SessionStart preflight. The v2 hook contract (run bracket, `edit.check`, `edit.touched`) is specified in V2-1.11 and V2-2.4b and in H-ai-parity §3.4, but not built.
- **A13** ("files are the API", ⏳ waiting for Michal's confirmation). Claude edits readable TSX/JSON in `.design/`, the `maude` CLI handles operations that aren't file edits, hooks keep the invariants, and there is no MCP.
- **The in-app chat is an Agent SDK session.** `acp/bridge.ts` drives the browser → dev-server → `claude-agent-acp` → `claude -p` chain. `allowedTools` currently includes the blanket `Bash(maude:*)`, which V2-2.4b narrows.

---

## 1. Evidence-backed principles

### 1.1 When sub-agents help and when they hurt

| Claim | Evidence |
| --- | --- |
| **Multi-agent pays off for breadth-first reading and costs about 15× the tokens.** | Anthropic's research system: an Opus lead with Sonnet sub-agents beat single-agent Opus by **90.2%** on their research eval. Agents use about 4× the tokens of chat and multi-agent systems about 15×. Token usage explains ~80% of variance on BrowseComp. Poor fit: "domains that require all agents to share the same context or involve many dependencies between agents… most coding tasks" [A1]. |
| **Parallel reading is safe, parallel writing is not.** | Cognition: "Share context" and "Actions carry implicit decisions, and conflicting decisions carry bad results." In the Flappy Bird example, two sub-agents produced a Mario-style background and a bird that didn't match [C1]. LangChain: read-heavy systems are easier than write-heavy ones, and Anthropic's research system parallelises reading while a single lead writes the report [L1]. |
| **Sequential tasks get worse with more agents.** | Google Research, 180 configurations: every multi-agent variant **degraded sequential reasoning by 39–70%**. Centralised coordination helped parallelisable tasks (+80.9%). Independent agents amplify errors **17.2×** versus **4.4×** with a central orchestrator acting as a "validation bottleneck". Coordination has diminishing or negative returns once the single-agent baseline exceeds ~45% [G1]. |
| **Multi-agent failures are mostly design failures.** | MAST taxonomy (NeurIPS 2025): 14 failure modes in 3 clusters (system design, inter-agent misalignment, task verification), from 1,642 traces across 7 frameworks [M1]. |
| **Maximise a single agent first.** | OpenAI's guide: "maximize a single agent's capabilities first". Split when prompts become tangled with conditional logic, or under *tool overload*. Overload is about overlap, not count: "more than 15 well-defined, distinct tools" can work while "fewer than 10 overlapping tools" can fail [O1]. Anthropic: "finding the simplest solution possible, and only increasing complexity when needed" [A2]. |
| **Sub-agents are for isolation, verbose output, and tool restriction.** | Claude Code docs: use the main conversation when "Multiple phases share significant context" or for "frequent back-and-forth or iterative refinement". Use sub-agents when "The task produces verbose output you don't need in your main context", to "enforce specific tool restrictions", or when "The work is self-contained and can return a summary" [CC1]. Context engineering: sub-agents return a "condensed, distilled summary", often 1,000–2,000 tokens [A3]. |
| **Specialisation should be composed from skills before building more agents.** | Anthropic on Agent Skills: rather than "fragmented, custom-designed agents for each use case", specialise a general agent with composable skills loaded by progressive disclosure [A4]. |
| **Agent teams are for independent owners of different files, not for same-file edits.** | Claude Code agent teams: "For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective." "Two teammates editing the same file leads to overwrites." Teams are unavailable in `-p` / Agent SDK sessions [CC3]. |
| **Fresh-context reviewers beat self-review.** | Claude Code best practices: Writer/Reviewer pattern; "a fresh context improves code review since Claude won't be biased toward code it just wrote"; an adversarial review sub-agent "sees only the diff and the criteria". It also warns that reviewers prompted to find gaps will find some, so flag only gaps that affect correctness or requirements [CC4]. |

**What this means for Maude.** A design canvas is the coding case, not the research case. A canvas is one TSX file (for example `.design/ui/v2/v2 Triage.tsx`) holding many artboards that share tokens, components and rhythm. Edits are iterative and conversational, and every layout choice is an implicit decision the next edit depends on. That points to one writer, which Gate 0 A4 ("one AI per artboard") already enforces at the product level. The parts that are read-heavy, parallel, or need verification are the ones to delegate: critics, footage, pictures, large boards, research, and design-system migration across many canvases.

### 1.2 Skills vs sub-agents vs slash commands vs hooks in Claude Code

| Primitive | What it is | Use in Maude for | Don't use for |
| --- | --- | --- | --- |
| **Skill** (`SKILL.md`; slash commands are now skills [CC5]) | Knowledge or a workflow loaded into the *current* context by progressive disclosure: the description is always loaded, the body on use, references on demand [A4, CC2] | Every editing competence: canvas conventions, artboards/kinds, interactions, Present order, annotations format, DS schema, video comp, file-format docs, which verb to run. `paths:` can auto-load the annotations skill when touching `*.annotations.json` [CC5] | Long reading jobs that flood context |
| **Slash command** (= user-invocable skill) | A named entry point; `disable-model-invocation: true` for side effects [CC5] | `/design:new`, `/design:edit`, `/design:system`, `/design:history`… These are orchestration recipes that run in the main chat | Holding domain knowledge that should also be auto-loaded |
| **Sub-agent** (`agents/*.md`) | Isolated context, own system prompt, `tools` allowlist, `model`, preloaded `skills`, frontmatter `hooks`, optional `isolation: worktree`. Can nest up to 3 levels [CC1] | Read-only analysis (critics, keeper, footage, `asset-describer`, `board-reader`, research). Bounded writers to files nobody else is editing (draw, migrator, per-canvas DS switch proposals). Security isolation (reconstruct) | The writer of the user's active canvas, and anything needing back-and-forth with the user |
| **Skill with `context: fork` + `agent:`** | Runs a skill's explicit instructions in a sub-agent; background by default; **"edits sit outside checkpoints"** [CC5] | Packaging a read-only procedure (for example "summarise this board") without a separate agent file | Writing canvases, since background fork edits escape `/rewind` |
| **Hook** | A deterministic script, HTTP call, prompt or agent run at a lifecycle event. PreToolUse can `deny`/`ask`/rewrite input. PostToolUse can feed `additionalContext` or block. Stop/SubagentStop exit 2 keeps the agent working. Frontmatter hooks are scoped to one agent [CC2, CC6] | **Every invariant**: locks, queue, scope, trash-not-`rm`, element-id preservation, schema validation, attribution, run bracket, "can't stop with red checks". "Put guardrails in hooks… a request, not a guarantee" [CC2] | Judgement calls (route those to skills) |
| **Agent teams** | Peer sessions with mailboxes and a shared task list; experimental; interactive sessions only [CC3] | Building Maude (the v2 run). DDR-130 relay debate in terminal sessions | The in-app chat (unavailable), same-file edits |
| **CLI verb** (`maude design <verb>`) | Deterministic executable logic reached through Bash (DDR-062) | Validation, rendering, screenshots, geometry, generation, export, history/trash. CLI is "the most context-efficient way" to reach services [CC4]. Code beats chains of tool calls (150k → 2k tokens in Anthropic's example) [A5] | Things that are a plain, readable file edit |

**Rule of thumb for Maude:** knowledge → skill; recipe → slash command; must-always-hold → hook; computation or side effects → `maude` verb; isolation, verification or parallel reading → sub-agent.

### 1.3 Making direct file edits reliable

| Principle | Evidence | Maude application |
| --- | --- | --- |
| **Lint every edit and reject edits that break syntax** | SWE-agent ablation on SWE-bench Lite: edit with linting **18.0%**, without **15.0%**, no edit command **10.3%**. Linting "is beneficial for stymieing cascading errors"; a prominent failure is repeated editing of the same snippet after a syntax error [S1] | PostToolUse `maude design check <file>` after every Edit/Write to `.design/**`. Exit 2 or `additionalContext` with the exact error and the fix |
| **Give the agent a pass/fail check, not "looks done"** | "Give Claude a check it can run… It's the difference between a session you watch and one you walk away from." The guidance includes a Stop hook as a deterministic gate [CC4]. Agent SDK: rules-based feedback, visual feedback (screenshots), and LLM-as-judge as the least robust option [A6] | Stop hook: the run can't end until touched files validate and each touched artboard has a fresh screenshot plus `canvas-errors` clean |
| **Post-process and autofix generated UI code** | v0 runs an AutoFix model mid-stream, a final pass, then a linter; its headline metric is error-free generation rate [V1] | `check` emits *fixable* findings, and an optional `--fix` handles the deterministic subset: id re-attachment, token nearest-match, schema repair |
| **Choose edit formats the model handles naturally; avoid escaping** | Anthropic ACI: keep formats "close to what the model has seen", avoid line-counting and escaping; "poka-yoke your tools" [A2]. Aider: search/replace or udiff formats instead of whole-file rewrites; udiff cut GPT-4 Turbo laziness (20% → 61%) [AI1, AI2]. Cursor built a separate fast-apply model because frontier models were "lazy" and inaccurate on large edits [CU1] | Claude Code's `Edit` is search/replace. Keep canonical formats anchor-friendly: one element per line in JSON (already true), stable `data-cd-id` on TSX elements. A hook warns when `Write` replaces an existing canvas over N lines (lazy rewrite, id loss) |
| **JSON for state the model shouldn't casually rewrite** | Anthropic long-running harness: a JSON feature list because the model is "less likely to inappropriately change or overwrite JSON files" than Markdown [A7] | `.meta.json`, `.annotations.json`, tokens manifest and run hand-offs as JSON with schemas. Prose (DS README) stays Markdown |
| **Don't force structured output during reasoning** | "Let Me Speak Freely?" (EMNLP 2024): format restrictions degrade reasoning, and stricter constraints degrade more. Free text first, then format, mitigates this [F1] | Agents reason in prose; the *file* or the hand-off JSON is the last step, validated by schema, not produced by constrained decoding |
| **Readable ids, actionable errors** | "Resolving arbitrary alphanumeric UUIDs to more semantically meaningful language" improved precision; errors should "clearly communicate specific and actionable improvements" [A8] | `check` output names the artboard by label and id, the element by role and handle, and says what to do ("element `cta-primary` lost `data-cd-id="e7"`; re-add it, since locks and arrows bind to it") |
| **Small, scoped diffs; one feature at a time; git or snapshots to recover** | Long-running harness: incremental progress plus commits to revert [A7]; checkpoints track only file-tool edits, not Bash [CC4] | All canvas writes go through Edit/Write, never `sed`, `cat >` or `node -e`; PreToolUse on Bash blocks writes into `.design/`. The run bracket provides one undo step |
| **Screenshot the result** | Best practices: "take a screenshot of the result and compare it… list differences and fix them" [CC4]. The harness post found end-to-end browser testing beats unit/curl self-checks [A7] | `maude design screenshot --screen <id>` per touched artboard, already step 9 of `/design:new` and step 7 of `/design:edit`. Make it a Stop-gate requirement, not prose |

### 1.4 Critics: external feedback, not intrinsic self-correction

- Models generally **fail to improve their reasoning by revising without external feedback**, and debate does not beat self-consistency at equal sample count [H1]. A critic loop is only as good as the external signal it reads: validator output, render, token diff, measured contrast.
- **LLM design critique is useful but weak.** UICrit few-shot plus visual prompting gave +55% feedback quality, but it still trails human designers. A reanalysis found LLM critiques correlate weakly with design-quality ratings (ρ≈0.19 vs 0.56 for human critiques) [U1].
- Anthropic: LLM-as-judge is "generally not a very robust method"; prefer deterministic graders, calibrate model graders, and give judges an "Unknown" exit [A6, A9].
- **Conclusion:** run the generate → verify loop (evaluator-optimizer [A2]) as **deterministic checks first**, then render checks, then a *routed, small* LLM panel, then a reduce pass (DDR-130). The writer applies fixes. Critics never write the canvas.

---

## 2. Recommendation for Maude v2

### 2.1 Topology: one writer, many readers

```
User ─► AI chat (main agent = THE writer for this run)
         │  loads skills by need: design · ui-kit/artboards · whiteboard · design-system · video-comp · contract-voice · studio-actions
         │  runs maude verbs: check · canvas-rects · screenshot · annotate --ops · ds-check · artboards-lint · canvas-errors · history/trash · open
         │
         ├─ read-only sub-agents (fresh context, return ≤2k-token hand-off + file refs)
         │    board-reader · asset-describer · footage-analyst ×N · ux-research-agent · media-generation-director
         │
         ├─ verifiers (fresh context, read-only, routed, ≤3 per pass)
         │    design-system-keeper · design-critic · a11y · copy · brand · motion · typography · signature-moment · draw-critic
         │
         └─ bounded writers (own a DISJOINT file set, schema-gated, return a review/proposal)
              draw-agent (new SVG asset) · footage-director (EDL JSON) · ds-migrator (DS canvas) · ds-switcher ×canvas (proposal files)
                                            ▲
hooks around every Edit/Write (main and sub-agents): edit.check → check → edit.touched → Stop gate
```

Invariants of the topology:

1. **At most one writer per file at a time.** It is the main agent unless a bounded writer was handed exclusive ownership of a file that the main agent and user aren't touching (a new SVG, a proposal file, a per-canvas worker under a project-wide switch). This is A4 ("one AI per artboard") applied to agents, enforced by `edit.check` against the run registry (V2-1.15), not by prompt.
2. **Sub-agents return references, not payloads.** Big outputs go to `_runs/<runId>/<agent>.json`, and the main agent gets a ≤2k-token summary plus paths. This avoids the "game of telephone" [A1] and context rot [A3].
3. **No sub-agent talks to the user.** Questions come back in the hand-off (`open_questions`), and the main agent asks one `AskUserQuestion` (DDR-130 synthesis rule).
4. **No hand-rolled relay** between sub-agents (DDR-130). If two specialists disagree, the main agent's reduce pass decides.

### 2.2 Agent inventory for v2: add, reshape, keep, or make a skill

| Candidate | Verdict | Why (principle) | Owns: files (write) / verbs | Tools |
| --- | --- | --- | --- | --- |
| **artboard / layout agent** | **Skill, not agent.** Extend `ui-kit` into an `artboards` reference (kinds, presets, safe zones, auto-layout words → CSS, interactions, Present order/notes) | Layout is sequential and shares context with intent; the same TSX file; A4 single writer [C1, G1, CC1] | Main agent writes canvas TSX + `.meta.json`; verbs `artboards-lint`, `canvas-rects`, `screenshot`, `check` | — |
| — parallel generation of a *new* multi-artboard canvas | **Optional fan-out, only behind an eval win.** Workers write **draft fragments** `_runs/<run>/artboards/<id>.tsx`, never the canvas; the main agent splices and harmonises | Parallel writes need disjoint files; a shared "style contract" (DS rev, shell prior, rhythm) must be in every spawn prompt to avoid Flappy-Bird drift [C1] | Worker: its fragment only; main: splice | `Read, Write(_runs/** via hook), Bash(maude design check/screenshot)` |
| **annotations / whiteboard agent (writer)** | **Skill (`whiteboard`), not a writing agent** | Annotations are feedback on the same canvas the main agent edits; writing needs the user's intent | Main agent via `maude design annotate --ops` (preferred) or direct Edit + `check` | — |
| **`board-reader`** | **Add** (read-only) | A large board (hundreds of stickies) is verbose and untrusted (whiteboard trust model `_guide-05`). Isolate the reading and return a structured brief [CC1, A3] | Writes `_runs/<run>/board-brief.json` only; verbs `read-annotations --json --rects`, `canvas-rects` | `Read, Bash(maude design read-annotations/canvas-rects)`; **no** Write to `.design/**`, no network |
| **ds-agent → `ds-migrator`** | **Add** (bounded writer; already in S12 as optional) | One-off, deterministic-first migration of `system/<ds>/` → Design system canvas (A9, A12, A16). The LLM handles only ambiguous mappings | Writes the new DS canvas + `tokens.json` in its own path; emits a **review**, never silently applies; verbs `ds-check`, `check`, `screenshot` | `Read, Write, Edit, Bash(maude design ds-check/check/screenshot)`; frontmatter PreToolUse restricts writes to the target DS paths |
| **`ds-switcher`** (switch canvases to another system, scope Folder/Project) | **Add as fan-out worker**, one per canvas | Canvases are separate files, so this is the safe parallel-write case (like `/batch`, or `claude -p` per file [CC4]). Output is a *proposal* for the A12 review sheet | Writes `_runs/<run>/ds-switch/<canvas>.patch.json` (or a proposal copy). The apply is done by the main agent or the UI after the review | `Read, Write(_runs/**), Bash(maude design ds-check/check)` |
| **video / timeline agent** | **Keep the current split.** `footage-analyst` (read-only fan-out) + `footage-director` (EDL JSON writer). **Timeline edits on the comp TSX stay in the main agent** via the `video-comp` skill | Analysis is parallel reading; cut decisions are one coherent writer; timeline edits are iterative with the user | `footage-director`: `<slug>.edl.json` (schema). New deterministic verbs `beats`, captions/transcribe as CLI, not agents | analyst: `Read` only (exemplary) |
| **`asset-describer`** | **Add** (read-only, no network; batched fan-out) | Search in pictures (B6) is pure parallel reading; mirrors `footage-analyst` (DDR-183 F2 posture) | Returns JSON per asset; the **orchestrator** writes the index sidecar after schema validation | `Read` only |
| **Critics (11)** | **Reshape** | Keep them fresh-context and read-only [CC4]. Today they have `Write`. Make them return the verdict in the hand-off, or restrict Write to `_runs/**` by frontmatter hook. Deterministic checks run *before* them; routing caps the panel at ≤3 per pass; the reduce pass stays | No canvas writes ever | `Read, Glob, Grep, Bash(maude design screenshot/check/…)` |
| **`design-system-keeper`** | **Keep**, and teach it the DS canvas model and `dsRev` (H-ai-parity §4.1) | Read-only audit; a deterministic grep backbone | — | unchanged |
| **`draw-agent` / `draw-critic`** | **Keep** (reference design) | A bounded writer of a new file with its own engine-grounded verify loop and an independent judge | SVG/JSX asset paths | unchanged |
| **`reconstruct-*`** | **Keep** | Security isolation (untrusted image, no Bash) is a legitimate sub-agent reason [CC1] | — | unchanged |
| **`media-generation-director`, `ux-research-agent`** | **Keep** | Read-only proposer and research | — | unchanged |
| **`_draw-design-rules`, `_draw-motion-rules`** | **Move** to `skills/draw/references/` (or `agents/_shared/` if the loader ignores it) | They register as agent types (H-ai-parity §1.3); agent descriptions cost context in every session [CC1, CC2] | — | — |
| **A "studio-actions" or "router" agent** | **Don't.** Keep routing in the main agent via the generated `studio-actions` skill index (V2-2.4b) | A routing agent adds a hop and loses context; OpenAI and Anthropic both start single [O1, A2] | — | — |

Net change: **+4 agents** (`board-reader`, `asset-describer`, `ds-migrator`, `ds-switcher`), **−2 pseudo-agents**, critics tightened, and **0 new writers on the active canvas**.

### 2.3 How the main AI chat routes

The main agent routes in four steps; no router agent is needed.

1. **Classify the intent with the `design` skill's routing table** (`_guide-08`, extended by the generated `studio-actions` index). Each registry action carries `agent: file | cli | human` (V2-1.11), and the index says which file to edit or which verb to run.
2. **Decide in-context or delegate with one rule.** Delegate only if at least one of these holds:
   - reading > ~20k tokens or untrusted (→ reader);
   - an independent check (→ verifier);
   - N independent files (→ fan-out workers);
   - a security sandbox (→ reconstruct-style).

   Otherwise do it in context with the right skill. Same-file and iterative work never delegates [CC1, CC3].
3. **Agent descriptions** stay short and state *who spawns them*:
   - writers say "Spawned only by `/design:system` / `/design:draw`; never auto-delegated" (the pattern `reconstruct-agent` and the flow debate seats already use);
   - read-only checks may say "use proactively".

   Total agent description budget stays well under the 15k-token warning [CC1].
4. **Skills load by need.** `whiteboard` gets `paths: ["**/*.annotations.json"]`, `design-system` gets `paths: ["**/system/**"]`, so the right format doc arrives when the file is touched [CC5].

### 2.4 Hand-off contract (every spawn and every return)

**Spawn envelope.** The main agent passes this in the prompt and also writes it to `_runs/<runId>/<agent>.in.json`:

```json
{
  "contract": "maude.agent-handoff/1",
  "runId": "r_2026…", "agent": "ds-switcher",
  "task": "Restyle canvas 'Landing' from system maude → maude-v2 (A12 switch, scope: Folder)",
  "scope": { "canvas": ".design/marketing/Landing.tsx", "artboardIds": ["hero","pricing"], "elementIds": [] },
  "owns":  [".design/_runs/r_…/ds-switch/Landing.patch.json"],
  "reads": [".design/system/maude-v2/**", ".design/marketing/Landing.*"],
  "context": { "ds": "maude-v2", "dsRev": "sha256:…", "fidelity": "strict", "brief": "<verbatim user words>",
               "styleContract": "shell prior + rhythm the main agent has already decided" },
  "checks": ["maude design check", "maude design ds-check --canvas …"],
  "budget": { "maxIterations": 3, "maxTokensHint": 60000 },
  "output": ".design/_runs/r_…/ds-switcher.Landing.out.json"
}
```

**Return.** The file is validated by schema, and the agent's final message is a ≤2k-token summary plus this path:

```json
{
  "contract": "maude.agent-handoff/1", "status": "done | partial | blocked | refused",
  "changed":  [{ "file": "…", "artboardIds": ["hero"], "elementIds": ["e7","e9"], "kind": "proposal | edit | new-file" }],
  "evidence": [{ "kind": "check", "cmd": "maude design check …", "exit": 0 },
               { "kind": "screenshot", "path": ".design/_runs/…/hero.png" }],
  "decisions": [{ "decision": "Mapped --brand-2 → accent-strong", "why": "same role, ΔE 3.1",
                  "alternatives": ["--x-brand-2 (own token)"], "reversible": true, "confidence": "high" }],
  "findings":  [{ "severity": "blocker | warning", "where": "hero › cta-primary (e7)", "what": "…", "fix": "…" }],
  "open_questions": ["Keep the gradient? maude-v2 has no gradient slot"],
  "next": "apply-after-review"
}
```

**The `decisions[]` block is the key part.** It answers Cognition's "actions carry implicit decisions" [C1]: every implicit choice becomes explicit, so the main agent can reconcile across workers before applying anything. It also feeds the existing "Decisions" convention of `/flow` and kg capture. Critics use the same envelope; their `findings[]` replace the current free-form JSON verdict, so the reduce pass merges one schema.

**Runtime state:** `_runs/` is new per-machine runtime state. Add it to **all four** runtime-state lists together (CLAUDE.md, DDR-115):

- `isMaudeRuntimeState` in `apps/studio/git/service.ts`;
- `cli/lib/gitignore-block.mjs`;
- the repo `.gitignore`;
- `isRuntimeStateRel` in `apps/studio/sync/file-membership.ts` and its `apps/hub` mirror.

Otherwise run artefacts sync to peers.

### 2.5 Reading and writing `.annotations.json` and canvas TSX safely

**Layer 1: format and schema**
- `.annotations.json` v2: export a JSON Schema generated from the element registry (`annotations/registry.ts`), so docs, `check` and the skill share one source. Keep the canonical "one element per line, deterministic order" layout. It makes `Edit` anchors unique (the element id is in the line) and git diffs per element.
- `.meta.json`: `canvas-meta.schema.json` already exists. Add v2 fields (interactions, Present order/notes, `dsRev`, `formatVersion`) and keep the viewport out of the file (DDR-115).
- Canvas TSX: convention doc plus lint rules:
  - `DCArtboard id` and kind present;
  - `data-cd-id` on every element that can be locked, bound or commented;
  - tokens via `var(--…)` only under `dsFidelity: strict`;
  - no absolute positioning in `kind="web"` (keeper A.10);
  - imports only from `@maude/canvas-lib` / `@maude/ds`.

**Layer 2: one validator verb** `maude design check <file…> [--json] [--fix=safe]` dispatches by file type:

| File | Checks | Notes |
| --- | --- | --- |
| `*.annotations.json` | `schema.ts` validation in **strict mode** | The UI's total-per-element mode *drops* bad elements, which is right for loading. For an agent write, a drop must be an **error**, otherwise an agent typo silently deletes an element. Add `validateBoard({strict:true})` |
| `*.meta.json` | Ajv against the schema | — |
| `*.tsx` | Parse; canvas build in the existing sandbox (`canvas-build-sandbox.ts`); `data-cd-id` preservation diff against the pre-edit snapshot; `artboards-lint`; `ds-check --canvas` | — |
| `system/**` | `ds-check` (A14: structure, never aesthetics) | — |

Output is actionable and human-readable [A8]; exit 1 means errors.

**Layer 3: hooks** (design plugin `hooks.json`; also in writer-agent frontmatter so they apply inside sub-agents [CC1, CC6]):

| Event | Matcher | Action |
| --- | --- | --- |
| `UserPromptSubmit` | — | `maude act run.begin` (run bracket; artboard claim per A4/V2-1.15). Fails open without a studio |
| `PreToolUse` | `Edit\|Write\|MultiEdit` on `.design/**` | `edit.check`: refuses a claimed or soft-locked artboard (A10), a file outside the run's scope or outside the agent's `owns`, and a `Write` that replaces an existing canvas over N lines (lazy-rewrite guard → "use Edit") |
| `PreToolUse` | `Bash` | Denies `rm`/`mv`/redirects into `.design/**` and points at `maude design trash` / `history`; denies non-`maude` writers into `.design/` (sed, tee, node -e), because Bash edits also escape checkpoints [CC4] |
| `PostToolUse` | `Edit\|Write\|MultiEdit` on `.design/**` | `maude design check <file> --json` → on failure `decision: block` + reason. The agent sees exactly what to fix, which is the SWE-agent lint guardrail [S1]. Then `edit.touched` (attribution "Claude Code", Made by AI, artboard rings, id-loss report) |
| `Stop` / `SubagentStop` | — | Gate: every file touched in the run validates, and every touched artboard has a post-edit screenshot plus `canvas-errors` clean, or the agent states why it can't. Exit 2 with the missing list; respect the block cap. Then `run.end` (one undo step) |

**Layer 4: render and look.** Per touched artboard, run `maude design screenshot --screen <id>` and Read the PNG, then compare against intent or the reference. This is the visual-feedback loop [A6, CC4], already step 9 and 7 of new/edit and now made mandatory by the Stop gate.

**Annotations write path (A13 nuance):**
- **Read:** always the file (`read-annotations --json --rects` for geometry-aware reading).
- **Write, preferred:** `maude design annotate --ops` (it exists). It is registry-validated, works in world coordinates and element ids, stamps `author:{kind:'ai'}`, and merges field patches through `expect` with concurrent human edits (DDR-242 §4). On a live, synced board this is the only way an AI edit doesn't overwrite a human's simultaneous text edit.
- **Write, allowed:** direct `Edit` of `.annotations.json`, valid offline or on unsynced boards. Gated by PostToolUse `check --strict`; the studio's file watcher turns the diff into ops.
- **Never:** hand-computed coordinates. `canvas-rects` is Step 0 (the whiteboard skill already says so). Secret ballot contents are never readable by the AI (A18).

**Canvas TSX write path:**
- `Edit` only for existing canvases, scoped to the claimed artboards.
- Keep `data-cd-id` ("never drop or reassign an id on an element you keep", enforced by `check`).
- Snapshot through the run bracket, not ad-hoc `_history` copies (V2-1.5).

### 2.6 How critics fit: generate → verify loop

```
write (main) ─► check (deterministic; hook) ─► render + screenshot ─► keeper (read-only, deterministic-heavy)
     ▲                                                                   │
     │                         routed LLM panel (≤3, fresh context, read-only, findings[] in hand-off schema)
     │                                                                   │
     └──── fix prompt ◄── reduce pass (main agent: dedupe, resolve contradictions, keep blockers + top lifts) ◄┘
stop: existing stop-condition vocabulary (_guide-11..14) + maxIterations; "stable-but-bland" exit retained
```

- **Deterministic before LLM.** Contrast, token use, ids, lint and schema run first and are free; LLM critics see only what deterministic checks can't judge. This follows "prefer deterministic graders" [A9] and the weak LLM-critique evidence [U1].
- **Critics get artefacts and criteria, not the writer's reasoning** (fresh-context reviewer [CC4]).
- **Report only gaps that affect correctness or the brief.** This avoids over-correction from reviewers prompted to find something [CC4].
- **Debate stays in DDR-130 territory:** reduce for everyone; relay only in terminal sessions with teams.

### 2.7 Anti-patterns to avoid

1. **Parallel writers on one canvas file** (artboard agent + annotations agent + DS agent at once). This causes overwrites and conflicting implicit decisions [C1, CC3].
2. **A router or manager agent in front of the main chat.** It adds a hop and loses the user's context [O1, A2].
3. **Sub-agents that ask the user questions or hold the conversation.** Questions go into `open_questions`.
4. **Passing big payloads through prompts** (whole boards, whole canvases, footage transcripts). Write to `_runs/` and pass paths [A1, A5].
5. **Rules in prose that must always hold** (locks, trash, ids). Put them in hooks [CC2].
6. **Silent repair on agent writes.** Total-drop validation is right for loading and wrong for AI writes; use strict mode.
7. **Bash or `sed` edits to `.design/**`.** They bypass checkpoints and hooks; deny them [CC4].
8. **Whole-file `Write` over an existing canvas.** It invites lazy placeholder rewrites and id loss [AI2, CU1].
9. **Critics with write access to the canvas, or critics grading their own fixes.**
10. **Unbounded critic panels and loops.** Cost grows about 15× with multi-agent setups [A1]; cap the panel and iterations.
11. **Relying on agent teams in the product.** They are unavailable in the Agent SDK / ACP session [CC3].
12. **Overlapping agent or skill descriptions.** Wrong triggers follow [CC2, O1]; keep one owner per capability in the generated `studio-actions` index.
13. **Delegated untrusted content flowing into high-privilege tools** (confused deputy, DDR-054/174). Readers of untrusted content get no Bash egress and no `.design/**` writes.

---

## 3. What to add to the v2 plan

### 3.1 Gate 0: proposed wording for A13 (for Michal; append to the recommendation cell)

> …held by design-plugin hooks around Claude's file tools plus the studio's file watcher. **Agents: one writer per run (the AI chat agent, using skills); sub-agents only for read-heavy analysis, independent verification, or writes to files nobody else is editing under the hand-off contract (`maude.agent-handoff/1`). Every `.design/**` edit is validated by `maude design check` in a PostToolUse hook; a run can't end with red checks or without a screenshot of each touched artboard. Annotations: the file is the format and the read path; `maude design annotate --ops` is the preferred writer on synced boards (per-element merge), direct edits are validated strictly.**

### 3.2 New Phase 1 spike

| ID | Spike | Must answer | Feeds |
| --- | --- | --- | --- |
| **V2-1.18** | **Agent topology + edit-safety harness** (A13, A4) | (1) Hand-off schema `maude.agent-handoff/1` (in/out, `decisions[]`, `findings[]`), stored under `_runs/` (+ the 4 runtime-state lists). (2) `maude design check` dispatch + strict annotations mode + TSX id-preservation diff: what is cheap enough for every PostToolUse (budget < 1.5 s per file; heavier checks move to the Stop gate). (3) Hook set (Pre/Post/Stop/SubagentStop) incl. Bash write-deny and the lazy-`Write` guard; fail-open without a studio. (4) **Eval-decided topology:** run the 30-task fixture eval (§3.4) on A = single writer + skills and B = A + {`board-reader`, parallel artboard draft fan-out, `ds-switcher` fan-out}. Keep a split only if it wins on quality or latency at ≤1.5× tokens with no drop in invariant pass^3. (5) Confirm agent teams are unavailable in the ACP session, and design for sub-agents only | S12, S4, S5, S10, V2-2.4b, V2-8.16 |

### 3.3 Work-package items

Add to **V2-2.4b** (foundation), since these are shared files owned by the lead:

- `maude design check` verb, plus a JSON Schema export for `.annotations.json` v2 from the registry; `canvas-meta.schema.json` v2 fields; `validateBoard({strict:true})`.
- Design-plugin hooks: UserPromptSubmit run bracket; PreToolUse `edit.check`, Bash write-deny and lazy-Write guard; PostToolUse `check` + `edit.touched`; Stop/SubagentStop gate.
- `cli/lib/handoff.schema.json` (`maude.agent-handoff/1`) + `_runs/` runtime-state classification across the four lists, with a tripwire test extension.

Add to **S12** (AI and tooling):

- New agents: `board-reader` (read-only), `asset-describer` (read-only, no network; already listed), `ds-migrator` (already listed, now with hand-off + review output), `ds-switcher` (fan-out worker, proposal-only).
- Critic reshape: all 11 drop `Write`, or get a frontmatter PreToolUse hook restricting Write to `_runs/**`; emit `findings[]` in the hand-off schema; `design-critic`'s JSON verdict maps onto it; the reduce pass merges one schema.
- Move `_draw-design-rules.md` / `_draw-motion-rules.md` out of `agents/`.
- Skills: an `artboards` reference in `ui-kit`/`design` (kinds, presets, interactions, Present order); `paths:` auto-loading for `whiteboard` and `design-system`; the `whiteboard` skill states the write-path rule (ops verb preferred on synced boards).
- `design` skill `_guide-08` routing: the delegation rule from §2.3; `_guide-09/10`: deterministic-first loop order.
- Agent descriptions: writers say "spawned only by …; never auto-delegated"; total description budget checked by a test.

### 3.4 Tests

**1. Agent eval suite** (`apps/studio/test/agent-evals/`, run headless via `claude -p --plugin-dir`; not a CI gate; Phase 1 baseline, then Phase 8 regression):

- **Fixtures (clean copy per trial; unlink hub; `NO_OPEN=1`, `MAUDE_NO_AUTOBUILD=1`; run alone per memory):**
  - small app canvas (5 artboards);
  - 21-artboard marketing canvas (Alligators-scale);
  - board with 300 annotations including bound arrows, locked elements and a hidden-ballot vote;
  - video comp with an EDL;
  - multi-DS project (`maude` + `maude-v2`);
  - canvas with a soft-locked artboard and a queued run.
- **About 30 tasks drawn from real transcripts and the five V2-8.16 journeys [A9].** Examples:
  - "make the pricing artboard denser";
  - "turn these stickies into artboards";
  - "add an arrow from note X to the CTA";
  - "switch the folder to maude-v2";
  - "cut to the beat";
  - "describe pictures and find the dog";
  - negative tasks: edit a locked artboard, delete a canvas, read ballots.
- **Graders:**
  - *code-based*: `check` green; only scoped files and artboards changed (diff scope); `data-cd-id` preserved; no `rm` of a canvas (trash row exists); `author.kind='ai'` on new annotations; DS switch produced a review, not an apply; no writes outside `owns`;
  - *render-based*: screenshot non-blank, `visual-sanity`;
  - *model-based*: rubric with an "Unknown" option, calibrated on 10 human-graded items [A9].
- **Metrics:**
  - **pass^3 for invariants** (must hold every time);
  - pass@3 for quality;
  - tokens, wall time and sub-agent count per task;
  - the A-vs-B comparison table goes into the V2-1.18 DDR.

**2. Hook contract tests (red-first, per memory "regression tests must fail first"):**
- PreToolUse denies an edit to a claimed artboard, a canvas `rm`, a `sed -i` into `.design/`, and a `Write` over an existing canvas.
- PostToolUse blocks an invalid `.annotations.json` (strict mode catches what UI mode would drop) and a TSX that lost an id.
- Stop blocks without screenshots.
- All hooks fail open with no studio.
- Revert each hook and watch the test go red.

**3. Hand-off schema tests:** every agent's sample output validates; the critic verdict → `findings[]` adapter round-trips; `_runs/` is classified as runtime state in all four lists (extend `sync-file-membership.test.ts`).

**4. Agent hygiene tests:**
- No agent in `plugins/design/agents/` lacks `name`/`description`, and no `_*.md` lives there.
- Critics have no unrestricted `Write`.
- Readers of untrusted content have no `Bash` egress or `WebFetch`.
- Total description tokens stay under budget.
- Writer agents' descriptions contain "never auto-delegated".

These extend `cli/lib/plugin-name-namespace.test.mjs`-style tests.

**5. V2-8.16 addition:** the agent eval suite's regression slice (graduated tasks) passes at ≥95% pass^3 on invariants with the released plugin in both the ACP chat and terminal Claude Code.

---

## Sources

- [A1] Anthropic — How we built our multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- [A2] Anthropic — Building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- [A3] Anthropic — Effective context engineering for AI agents: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- [A4] Anthropic — Equipping agents for the real world with Agent Skills: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- [A5] Anthropic — Code execution with MCP: https://www.anthropic.com/engineering/code-execution-with-mcp
- [A6] Anthropic/Claude — Building agents with the Claude Agent SDK: https://claude.com/blog/building-agents-with-the-claude-agent-sdk
- [A7] Anthropic — Effective harnesses for long-running agents: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- [A8] Anthropic — Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- [A9] Anthropic — Demystifying evals for AI agents: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- [CC1] Claude Code docs — Subagents: https://code.claude.com/docs/en/sub-agents
- [CC2] Claude Code docs — Extend Claude Code (features overview): https://code.claude.com/docs/en/features-overview
- [CC3] Claude Code docs — Agent teams: https://code.claude.com/docs/en/agent-teams
- [CC4] Claude Code docs — Best practices: https://code.claude.com/docs/en/best-practices
- [CC5] Claude Code docs — Skills: https://code.claude.com/docs/en/skills
- [CC6] Claude Code docs — Hooks reference: https://code.claude.com/docs/en/hooks
- [C1] Cognition — Don't Build Multi-Agents: https://cognition.com/blog/dont-build-multi-agents
- [L1] LangChain — How and when to build multi-agent systems: https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems
- [O1] OpenAI — A practical guide to building agents (PDF): https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- [G1] Google Research — Towards a science of scaling agent systems (arXiv 2512.08296): https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/ · https://arxiv.org/abs/2512.08296
- [M1] Cemri et al. — Why Do Multi-Agent LLM Systems Fail? (MAST, NeurIPS 2025): https://arxiv.org/abs/2503.13657
- [S1] Yang et al. — SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering (Table 3 ablation): https://arxiv.org/abs/2405.15793
- [AI1] Aider — Edit formats: https://aider.chat/docs/more/edit-formats.html
- [AI2] Aider — Unified diffs make GPT-4 Turbo 3X less lazy: https://aider.chat/docs/unified-diffs.html
- [CU1] Cursor — Instant Apply: https://cursor.com/blog/instant-apply
- [V1] Vercel — v0 composite model family (AutoFix, linter pass): https://vercel.com/blog/v0-composite-model-family
- [F1] Tam et al. — Let Me Speak Freely? Format restrictions and LLM performance (EMNLP 2024, arXiv 2408.02442): https://arxiv.org/abs/2408.02442
- [H1] Huang et al. — Large Language Models Cannot Self-Correct Reasoning Yet (ICLR 2024): https://arxiv.org/abs/2310.01798
- [U1] Duan et al. — UICrit (UIST 2024): https://arxiv.org/abs/2407.08850 ; follow-up evidence summarised from PerceptUI https://arxiv.org/pdf/2606.05697 and a 2025 reanalysis https://journal.stekom.ac.id/index.php/ijgd/article/view/3661

**Repo sources (read-only):** `CLAUDE.md`; `plugins/design/agents/*.md` frontmatter; `plugins/design/skills/*/SKILL.md`; `plugins/design/skills/whiteboard/SKILL.md`; `plugins/design/hooks/hooks.json`; `apps/studio/annotations-model.ts`, `annotations/{schema,ai-write,lock}.ts`; `apps/studio/bin/{annotate,read-annotations}.mjs`; `apps/studio/acp/bridge.ts`; `.ai/plans/feature-maude-v2-redesign.md` (Gate 0 A4/A9/A10/A12/A13, V2-1.11, V2-2.4b, S12, V2-8.16); `.ai/plans/notes/v2-inventory/H-ai-parity.md` §1, §3.4–§5; kg: DDR-062, DDR-130, DDR-174, DDR-183, DDR-242.

**Caveats:**
- Several figures come from vendor blogs (Anthropic, Vercel, Cursor, aider) measured on their own tasks. Treat them as direction, not transferable effect sizes.
- The OpenAI guide was read from the PDF text.
- The UICrit follow-up numbers are from secondary studies.
- The A-vs-B question for Maude specifically is unanswered until the V2-1.18 eval runs.

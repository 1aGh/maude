---
name: critic
category: daily
description: "Review the active canvas with the selected specialist critic panel."
argument-hint: "[--agent <name>] [--all] [--panel] [--system-only [--ds=<name>] [--all-ds]] [--opt-out=palette|aesthetic|full]"
---

# /design:critic — review active canvas

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Reviews the active canvas in one pipeline: **deterministic checks → render → keeper → at most 3 critics**, routed by `skills/design/_guide-09` (the routed panel; `--agent` and `--all` are explicit). Every critic is spawned with a **`maude.agent-handoff/1` hand-off** (contract V2-1.18 §5.2). It writes only its result and its report in the run folder, runs `maude design check <output>` on its result, and never edits the canvas. You — the main agent — read the results, reconcile them, and post the findings as AI comments on the canvas: **one batched call per `/design:critic`** (step 9).

This command **does not run the auto-fix loop** — `/design:edit` and `/design:new` do, after every edit, with the same pipeline (`_guide-10`/`_guide-13`) and without posting comments. `/design:critic` is a pure review; for auto-fix over several rounds use `/design:edit "<feedback>" --perfect`.

## Modes

| Flag | Behavior |
|---|---|
| (none) | **Routed panel** — at most 3 critics, picked from the canvas content + the latest feedback (`skills/design/_guide-09`): `design-critic` + `a11y-critic` always, plus the one specialist the routing ranks first. |
| `--agent <name>` | A single specialist only (no keeper). Available: `design-critic`, `graphic-design-critic`, `brand-critic`, `typography-critic`, `motion-critic`, `a11y-critic`, `copy-critic`, `frontend-critic`, `info-architecture-critic`, `signature-moment-critic`, `draw-critic`. |
| `--all` | All 11 critics in parallel — the one way past the cap of 3. Heavy: about 11× the tool calls. Use for an exhaustive polish before a hand-off. |
| `--panel` | Alias for default (no flag). |
| `--opt-out=<scope>` | Override the canvas's persisted scope for this critique only. Without this flag, the scope is the `opt_out_scope` field of the canvas's `.meta.json` (default `palette`). It goes into every hand-off as `context.styleContract.optOutScope`: design-stack critics downgrade matching DS-rule blockers; the a11y / frontend / copy critics ignore it. See SKILL.md "Opt-out scope". |
| `--system-only` | **Audit the design system itself, not the active canvas.** Runs `maude design ds check-system`, then the completeness critic and the keeper (system mode) on hand-offs, and posts their findings on the Design system canvas (step 2b) — what "Ask AI to review" starts. Combine with `--ds=<name>` to scope to one DS in a multi-DS project, or `--all-ds` to audit every entry in `designSystems[]`. Default target is `config.defaultDesignSystem` (single-DS layouts: `project`). |

## Procedure

Invoke skill `design` with input: `critic <flags>`. Text you write into Maude for the person — comment text, the summary — follows skill `contract-voice`.

### 0. Run folder and round

The design plugin's hook names the run folder once per conversation, in a line like `Maude run folder for this conversation: .design/_runs/<session>/ (run id r_…)`. Use that folder as `RUN` and that run id. No such line (hooks off, or a host without plugin hooks): use `RUN=.design/_runs/local/` and run id `r_local`.

The round number `<n>` (`N` below) is one more than the highest `<n>` among `$RUN/handoff/*-<n>.in.json`, or `0` for the first round. Every file this round writes carries it. Create the two folders once: `mkdir -p "$RUN/handoff" "$RUN/critique"`.

### 1. Server and active canvas

```bash
PORT=$(maude design server-up)
maude design prep --json     # config, the active canvas, the selection, the server probe
```

No active canvas → stop with "Open a canvas in Maude first." The canvas is `CANVAS` (repo-relative, `.design/ui/<Name>.tsx`); a selected element gives `scope.elementIds`, a selected artboard `scope.artboardIds`.

### 2. Deterministic checks — free, and first

```bash
maude design check "$CANVAS" --tier stop --json > "$RUN/critique/check-$N.json"
```

Its `errors` are blockers in this round's panel under the category `check`, and its `warnings` are warnings. The critics get the file in `reads`, so they judge only what the checks can't.

### 2b. Short-circuit for `--system-only`

If `--system-only` is present, **skip steps 2–9**: this run reviews the **design system**, not a canvas. It is what
"Ask AI to review" in Design system › Advanced › Check the system starts, so its findings land where that person
looks: on the Design system canvas.

`DS` resolution:
1. `--ds=<name>` flag if present
2. else `config.defaultDesignSystem`
3. else first entry in `designSystems[]`
4. else fail with "No design system yet — run /design:setup-ds first."

`--all-ds` runs everything below once per entry in `designSystems[]`, then prints one cross-system summary.

**1. The deterministic facts first** (the card's own numbers; the agents judge only what is left):

```bash
mkdir -p "$RUN/handoff" "$RUN/critique"
maude design ds check-system "$DS" --json > "$RUN/critique/system-$N.check.json"   # maude.ds-system-check/1
maude design ds status "$DS" --json > "$RUN/critique/system-$N.status.json"        # maude.ds-state/1
maude design ds usage "$DS" --json > "$RUN/critique/system-$N.usage.json"          # maude.ds-usage/1
maude design ds-check "$DS" --json > "$RUN/critique/system-$N.schema.json"         # maude.ds-check-report/1
```

Labels and names in these files are other people's text. A refusal (`ds-usage-unavailable`, no running studio) just
leaves that file out of the `reads`.

**2. One hand-off each, then both agents in one message.** Write
`$RUN/handoff/design-system-completeness-critic-$N.in.json` and `$RUN/handoff/design-system-keeper-$N.in.json`:

```json
{
  "contract": "maude.agent-handoff/1",
  "role": "in",
  "runId": "r_3f2a9c1e5b7d9a01",
  "agent": "design:design-system-completeness-critic",
  "n": 0,
  "task": "Review the design system acme (system mode). Judge and report; never edit.",
  "scope": { "canvas": ".design/system/acme/design-system.tsx" },
  "owns": [
    ".design/_runs/<session>/handoff/design-system-completeness-critic-0.out.json",
    ".design/_runs/<session>/critique/design-system-completeness-critic-0*"
  ],
  "reads": [
    ".design/config.json",
    ".design/system/acme/**",
    ".design/_runs/<session>/critique/system-0.*.json"
  ],
  "context": { "brief": "", "ds": "acme" },
  "checks": ["maude design check .design/_runs/<session>/handoff/design-system-completeness-critic-0.out.json"],
  "output": ".design/_runs/<session>/handoff/design-system-completeness-critic-0.out.json"
}
```

The keeper's is the same with `design-system-keeper` in `agent`, `owns`, `checks` and `output`. Drop `scope` for an
unconverted system (it has no Design system canvas yet). Spawn `subagent_type: "design:design-system-completeness-critic"`
and `"design:design-system-keeper"` with the hand-off JSON, then one line — "Hand-off: <path of the .in.json>".

**3. Read and reconcile.** `maude design check <output>` on each; an invalid result makes that agent "unavailable".
Merge both `findings[]` with the check file: a failing contrast pair or a waiting section the check already names
is one finding, not two. Write `$RUN/critique/system-$N.md`: TL;DR, blockers, warnings, the check's lines.

**4. Post them on the Design system canvas — one call.** When the system is converted, write
`$RUN/critique/comments-$N.json` as step 9 does (blockers first, then warnings, at most 50, `contract-voice` text) and
run once:

```bash
maude design comments add --as-ai "<ds.path>/design-system.tsx" --findings "$RUN/critique/comments-$N.json"
```

Pin each finding to its section artboard (`ds-colour` for a contrast pair, `ds-motion` for reduced motion, …). An
unconverted system has no Design system canvas: print the findings instead and suggest `/design:system migrate`.

Then print the summary block and exit — `--system-only` runs are standalone, never part of an auto-fix loop, and
never change a token: the person fixes from the comments (or asks for `/design:system`).

### 3. Render

```bash
maude design screenshot --canvas "$CANVAS" --all-screens --out-dir "$RUN/critique/shots-$N/"
# with a selected element, also:
maude design screenshot --canvas "$CANVAS" --element "<id>" --out "$RUN/critique/shots-$N/el-<id>.png"
```

The critics read these; they capture only when none is listed. No screenshot possible (no browser engine) → the critics review the source only and say so.

### 4. Keeper (routed panel and `--all`)

When the canvas uses a design system, spawn `design:design-system-keeper` with the envelope `/design:new` step 9.5 documents (showcase, brand specimens, `opt_out_scope`, `ds_fidelity`). It is read-only and returns its verdict JSON in its final message. Save that JSON to `$RUN/critique/keeper-$N.json` for the critics' `reads` and the panel. A keeper failure never blocks the panel.

### 5. Pick the critics

- `--agent <name>` → that one. Unknown name → fail with the list above.
- `--all` → all 11.
- else → the routed panel, **at most 3** (`_guide-09` § Routing rules + § The cap).

### 6. Write one hand-off per critic, then spawn them in parallel

For each critic, write `$RUN/handoff/<critic>-$N.in.json`. The critic **owns** only its result and the files next to its report — never the canvas:

#### Sample hand-off

```json
{
  "contract": "maude.agent-handoff/1",
  "role": "in",
  "runId": "r_3f2a9c1e5b7d9a01",
  "agent": "design:design-critic",
  "n": 0,
  "task": "Review .design/ui/Pricing.tsx as design-critic, round 0 of an explicit /design:critic. Judge and report; never edit.",
  "scope": { "canvas": ".design/ui/Pricing.tsx", "artboardIds": ["hero", "plans"] },
  "owns": [
    ".design/_runs/<session>/handoff/design-critic-0.out.json",
    ".design/_runs/<session>/critique/design-critic-0*"
  ],
  "reads": [
    ".design/ui/Pricing.tsx",
    ".design/config.json",
    ".design/system/acme/colors_and_type.css",
    ".design/_runs/<session>/critique/shots-0/*.png",
    ".design/_runs/<session>/critique/check-0.json",
    ".design/_runs/<session>/critique/keeper-0.json"
  ],
  "context": {
    "brief": "make the plans calmer",
    "ds": "acme",
    "fidelity": "strict",
    "styleContract": { "optOutScope": "palette", "iter": 1 }
  },
  "checks": ["maude design check .design/_runs/<session>/handoff/design-critic-0.out.json"],
  "output": ".design/_runs/<session>/handoff/design-critic-0.out.json"
}
```

- `context.brief` is the person's latest feedback, verbatim (`""` when there is none).
- `context.fidelity` is `config.dsFidelity`: `strict` → `strict`, `advisory` → `loose`; scope `full` makes it `loose` (DDR-141).
- `context.styleContract.optOutScope` is the scope from `--opt-out` or the sidecar.
- Drop `artboardIds` / `elementIds` to review the whole canvas.

Then **one message with N `Agent` calls** (they run in parallel):

```
subagent_type: "design:<critic>"
description: "Critique <canvas> (round <n>)"
prompt: the hand-off JSON, then one line — "Hand-off: <path of the .in.json>"
```

The design plugin's hook holds each critic to its hand-off: a write outside `owns` is refused `out-of-scope`, and the critic can't stop until its result validates.

### 7. Read the results

For each critic, run `maude design check <output>`. A missing or invalid result → that critic is "unavailable" in the panel; continue with the rest. A valid result maps to the verdict the loop and the panel read, as `handoffToCriticVerdict` does (`cli/lib/handoff.mjs`):

| Verdict field | From the `HandoffOut` |
|---|---|
| `agent` | `agent` without `design:` |
| `blockers`, `warnings`, `passed`, `iter` | `result.verdict` |
| `top_blockers[]` = `{category, line, summary, fix}` | the `blocker` findings in order: `where` = `<category>:<line>`, `what` = summary |
| `aspiration_score`, `specificity` | `result.verdict` (signature-moment-critic) |
| `opt_out_applied`, `ds_blockers_downgraded` | `result.verdict` |

Questions in a critic's `open_questions` are for the person: ask them once, after step 8, never back to the critic.

### 8. Consolidate

Write `$RUN/critique/panel-$N.md` (schema: `_guide-09` § Panel consolidation report) whenever more than one source reported — critics, the check, the keeper:

- TL;DR (total blockers/warnings, verdict)
- Blockers grouped by category, sorted by count
- **Reconciled blocker list** (the reduce-pass output — step 8.1; falls back to the raw grouped list when `orchestration.mode:off`)
- Per-critic table with a link to each result and report
- Top blockers across the panel (sorted: check > a11y > ds-tokens > others)
- Final JSON verdict block (panel-level)

#### 8.1 Reduce-pass — reconcile conflicting blockers (DDR-130)

A raw *sum* of independent verdicts makes the `/design:edit` loop chase conflicting blockers serially and oscillate (signature-moment adds drama → a11y rejects on contrast → motion re-flags). The reduce-pass collapses that into **one reconciled, ordered blocker list** before the edit loop runs.

Read `orchestration.mode` from `.ai/workflows.config.json` (absent → `auto`). **`mode:off` → skip this step** (the raw grouped list stands; behavior unchanged). Otherwise run **one** consolidator pass (inline or a single subagent) that:

1. **Reads** every critic's `HandoffOut` `findings[]` + `result.verdict`, the check results and the keeper's verdict (read-only over the finished results).
2. **De-duplicates** blockers multiple critics flag → one entry that lists the flagging critics.
3. **Resolves conflicts** — where fixing critic A's blocker would reintroduce critic B's (contrast ↔ aspiration, density ↔ negative-space, motion ↔ reduced-motion): emit ONE resolution per conflict (which constraint dominates per the DS hard-stops, a11y always wins; or a *conditional* that satisfies both, e.g. "gradient confined to the upper band so the text plate keeps 4.5:1").
4. Emits a single ordered list (check > a11y > ds-tokens > others, conflicts resolved) into the panel's **Reconciled blocker list**.

**This is the `reduce` tier — strictly read-over-outputs.** It MUST NOT route one critic's result into another critic as a prompt, re-spawn critics, or fabricate a critique — that is the `relay` design-team tier (step 8.2). It only reduces finished verdicts into one coherent list. See `flow:debate-protocol` (reduce-vs-relay).

#### 8.2 Relay design-team — live reconciliation (optional — `orchestration.designTeam`)

For maximum reconciliation quality, escalate the reduce-pass to a **live design-team** (**opt-out** — on unless `orchestration.designTeam.enabled` is explicitly `false`) when: native agent-teams capability (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) detected AND the panel produced **≥ `orchestration.designTeam.minConflicts`** cross-discipline conflicting blockers (fixing critic A's reintroduces critic B's). Then, via **`flow:debate-protocol`**, the conflicting critics convene as a native team and **revise their stances after hearing each other** — e.g. `a11y-critic` narrows its contrast constraint to the text band so `signature-moment-critic` can keep the bold hero, and `motion-critic` drops its reduced-motion blocker once the revised moment is compositor-only. The reconciled (often blocker-free) list replaces the step-8.1 output.

This is the ONLY place `/design:critic` uses the `relay` tier; it fires only on genuine cross-discipline conflict (the stakes-gate), never on a single-discipline panel. When `designTeam.enabled` is false or no conflict crosses the threshold, the step-8.1 reduce-pass stands. The team NEVER prompts the user; the reduce-vs-relay line holds — only the native runtime relays. Agent teams exist only in a terminal session; in Maude's AI chat this step never fires (V2-1.18).

### 9. Post the findings as AI comments — one call (explicit `/design:critic` only)

The reconciled blockers and the warnings land on the canvas as **AI comments**, so the person and their teammates see them where the work is. Write `$RUN/critique/comments-$N.json`: blockers first, then warnings, at most 50, each

```json
{ "text": "Contrast is 3.1:1 on the plan meta line — use var(--fg-1).", "artboard": "plans" }
```

- `text`: the finding and its fix in one or two plain sentences (`contract-voice`), with no severity codes or line numbers.
- `artboard`: the `DCArtboard` the finding's line sits in, when you can tell; leave it out for a canvas-wide finding.

Then post them in **one** call (it shows one permission prompt):

```bash
maude design comments add --as-ai "$CANVAS" --findings "$RUN/critique/comments-$N.json"
```

- Exit 3 (no studio running) → say "Comments not posted — Maude isn't running for this project. The findings are in <panel path>." and continue.
- Exit 1 (`read-only`, `not-in-scope`) → say why, and continue.
- Nothing to post (0 blockers, 0 warnings) → skip the call.

The auto-critic loop inside `/design:edit` and `/design:new` **never** posts comments (one round per edit would bury the thread).

### 9.5 Record the verdict in the graph (kgai — when active)

The run folder is runtime state (DDR-115): a critique — the record of *why* a canvas looks the way it does — never leaves this machine. When the graph is active it becomes the only inheritable copy.

After the results are final (post-8.1/8.2, so the recorded list is the reconciled one):

```bash
# The consolidated panel — one node per critique round.
maude kg record-log --file "$RUN/critique/panel-$N.md" \
  --kind critic-verdict --about "canvas:<slug>" --link EVALUATES

# Single-critic run (no panel written) — record that critic's report instead.
maude kg record-log --file "$RUN/critique/<critic>-$N.md" \
  --kind critic-verdict --about "canvas:<slug>" --link EVALUATES
```

Record the **panel** when one exists, the single report otherwise — never both, or the same round counts twice. The verb gates itself and is a **silent no-op when the graph is inactive**, so run it unconditionally. It derives a per-canvas slug automatically (`<canvas>-<NNN>-PANEL`) — without that, two canvases' panels collapse into one node and the second silently overwrites the first. Contract: **`flow:kgai-backend`**.

### 10. Print summary

```
✓ Reviewed <canvas> (round <n>)
  Critics ({N}): {list}  ·  checks: {errors} errors  ·  keeper: {blockers} blockers
  Blockers: X · Warnings: Y · Verdict: {pass | fix-and-retry}
  Comments: {K} posted on the canvas | not posted — {why}

  Top blockers:
  1. [{agent}/{category}] L{N} — {summary}
  …

  Results: <RUN>/handoff/*-<n>.out.json
  Panel:   <RUN>/critique/panel-<n>.md

  Next:
  - If blockers > 0: /design:edit "Address: <top blocker summary>" — or /design:edit "..." --perfect to auto-fix in a loop.
  - If blockers == 0: /design:handoff [--target <label>] when ready.
```

## Failure modes

| Symptom | Action |
|---|---|
| No active canvas | fail: "Open a canvas in Maude first." |
| Screenshot cannot be captured (no browser engine) | the critics review the source only; each says "Visual evidence: source only" in its summary. |
| Tokens CSS unreadable | `design-critic` + `a11y-critic` return `status: "blocked"` (they need tokens for compliance + contrast). Other critics continue. |
| A critic fails to spawn, or its result is missing / invalid | report it as "unavailable" in the panel; continue with the rest. |
| A critic's write refused `out-of-scope` | expected — it tried to write outside its hand-off. Its result says what it meant; you apply fixes. |
| `--agent <unknown>` | fail with a list of available critics. |

## Tips

- **Targeted critique** — select an element or an artboard on the canvas, then `/design:critic`. The routing narrows to it, and the hand-offs carry its id in `scope`.
- **Fast iteration loop** — `/design:edit "..."` (default = 4-round multi-axis auto-critic with the stable-but-bland exit) is faster than `/design:critic` + a manual follow-up. `/design:critic` is a standalone review (no auto-fix).
- **Pre-handoff polish** — `/design:critic --all` for an exhaustive review, then `/design:edit "..." --perfect` if there are blockers, then `/design:handoff`.
- **Single discipline** — `/design:critic --agent typography-critic` for a pure type review (no UX / DS / a11y noise).

## Discoverability — what each critic does

| Critic | Domain |
|---|---|
| `design-critic` | Holistic UX (7-layer walk) + design-system compliance (tokens, hard-stops). Default + auto-baseline. |
| `graphic-design-critic` | Composition, hierarchy, balance, density, rhythm, white-space, gestalt. |
| `brand-critic` | Logo integrity, asset ladder, voice/tone alignment, photography style, brand drift. |
| `typography-critic` | Pairings, scale ladder, leading, measure, tracking, numerals, vertical rhythm, fallbacks. |
| `motion-critic` | Duration tokens, easing, choreography, prefers-reduced-motion, compositor properties, role-vocabulary fidelity (Phase 3.7 / DDR-049 — 8-role canvas-lib vocabulary, bounded geometry, sparkle-≤56px, motion specimen looping on first paint). **Always-on bucket alongside `a11y-critic` whenever `system/<ds>/preview/motion.tsx` exists — `--opt-out=motion` cannot disable it during DS bootstrap.** |
| `a11y-critic` | WCAG 2.1 AA — contrast, keyboard, focus, landmarks, labels, touch targets, ARIA. **Always in panel.** |
| `copy-critic` | Microcopy, action verbs, empty/error states, tone, casing, i18n readiness. |
| `frontend-critic` | JSX patterns, semantic HTML, hooks, keys, performance gotchas, hydration. |
| `info-architecture-critic` | Nav depth, hierarchy, taxonomy, findability, URL hygiene, cross-surface consistency. |
| `signature-moment-critic` | **Aspiration axis** — measures *presence of greatness*, not absence of badness. 5 axes (signature compositional moment per artboard, brand prominence, mock fidelity, restraint, negative space) + specificity gate (no Lorem / placeholders). **The routed third seat for `/design:new` and polish-cued `/design:edit`.** Closes the gap between "passes correctness" and "would screenshot for portfolio". |
| `draw-critic` | **Standalone vector art** (logo / icon / illustration / diagram / spot) — 30-check draw rubric with a HARD floor (WCAG · 4/8pt grid · 16px legibility · single-color flatten). Routed when the canvas carries a custom `<svg>` mark or feedback mentions `logo\|icon\|illustration\|diagram\|svg\|vector`. The gap `graphic-design-critic` doesn't cover (it handles the whole-canvas composition, not the mark). |
| `design-system-completeness-critic` | **Structural completeness of the design system itself** — tokens, philosophy, specimens, shape. 3-tier rules (Core blocker / Conventional warning gated by `activeFamilies` + `completenessProfile` / Free-form acknowledged). **Spawned only via `--system-only`** (or auto-run at the end of skill `design-system` bootstrap flow). NOT included in canvas critic panels — different scope. |

Full critic prompts: `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md`.

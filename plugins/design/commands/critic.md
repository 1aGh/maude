---
name: critic
category: daily
description: "Review the active canvas with the selected specialist critic panel."
argument-hint: "[--agent <name>] [--all] [--panel] [--system-only [--ds=<name>] [--all-ds]] [--opt-out=palette|aesthetic|full]"
---

# /design:critic — review active canvas

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Runs one or more `*-critic` subagents on the active canvas (`_active.json`). Each critic emits a **JSON verdict block** at the end of its report — the orchestrator parses it and (if >1 critic) writes a consolidated `<NNN>-PANEL.md`.

This command **does not run the auto-fix loop** — that's what `/design:edit` and `/design:new` do after every edit. `/design:critic` is a pure review action; for auto-fix with multiple iterations use `/design:edit "<feedback>" --perfect`.

## Modes

| Flag | Behavior |
|---|---|
| (none) | **Routed panel** — orchestrator picks critics based on canvas content + latest feedback (see `skills/design/SKILL.md` "Critic panel routing"). Always includes `design-critic` + `a11y-critic`, the rest conditionally. |
| `--agent <name>` | A single specialist only. Available: `design-critic`, `graphic-design-critic`, `brand-critic`, `typography-critic`, `motion-critic`, `a11y-critic`, `copy-critic`, `frontend-critic`, `info-architecture-critic`, `signature-moment-critic`, `draw-critic`. |
| `--all` | All 9 critics in parallel. Heavy — spends 9× the tool calls. Use for "exhaustive polish before handoff". |
| `--panel` | Alias for default (no flag). |
| `--opt-out=<scope>` | Override the canvas's persisted scope for this critique only. Without this flag, scope is read from `<active>.meta.json` `opt_out_scope` (default `palette`). Passes to every spawned critic — design-stack critics downgrade matching DS-rule blockers per scope; a11y / frontend / copy critics ignore it. See SKILL.md "Opt-out scope". |
| `--system-only` | **Audit the design system itself, not the active canvas.** Spawns only `design-system-completeness-critic` against `<designRoot>/system/<ds>/`. The critic applies 3-tier rules (Core / Conventional / Free-form) calibrated by `config.json.completenessProfile` + `activeFamilies[]`. Combine with `--ds=<name>` to scope to one DS in a multi-DS project, or `--all-ds` to audit every entry in `designSystems[]`. Default target is `config.defaultDesignSystem` (single-DS layouts: `project`). |

## Procedure

Invoke skill `design` with input: `critic <flags>`.

### 1. Server lifecycle check + read active state

Standard (see `/design:edit`).

### 2. Capture screenshot if missing

If the latest screenshot for the canvas is missing, capture full-page via agent-browser (HTTP server URL, not `file://`).

If `_active.json.selected` is set, also capture element-scoped (`--selector "<selected.selector>"`).

### 2b. Short-circuit for `--system-only`

If `--system-only` is present, **skip canvas-screenshot logic and skip the panel-routing logic**. Spawn only `design-system-completeness-critic`:

```
subagent_type: design:design-system-completeness-critic
prompt: structured payload (config_path, ds_name, ds_root, output_path, all_ds)
```

`ds_name` resolution:
1. `--ds=<name>` flag if present
2. else `config.defaultDesignSystem`
3. else first entry in `designSystems[]`
4. else fail with "no design system configured — run /design:setup-ds first"

When `--all-ds` is set, pass `all_ds: true` so the critic produces per-DS sections in the report (one block per entry in `designSystems[]` + a cross-DS summary).

Output goes to `<designRoot>/_history/_system/<NNN>-completeness-{ds-or-all}.md` (separate from canvas-scoped reports because there's no canvas slug).

After the critic returns, print the verdict summary and exit — `--system-only` runs are standalone, not part of an auto-fix loop.

### 3. Pick panel

```bash
ARGS="$@"
if [[ "$ARGS" == *"--agent "* ]]; then
  PANEL=( $(extract --agent value) )
elif [[ "$ARGS" == *"--all"* ]]; then
  PANEL=(design-critic graphic-design-critic brand-critic typography-critic motion-critic a11y-critic copy-critic frontend-critic info-architecture-critic signature-moment-critic draw-critic)
else
  # Routed panel — see skills/design/SKILL.md "Critic panel routing"
  PANEL=( $(route_panel "$CANVAS" "$LAST_FEEDBACK" "$SELECTED") )
fi
```

### 4. Spawn critics in parallel

**One message with N `Agent` tool calls** (parallel execution). Each call:

```
subagent_type: "design:<critic-name>"
description: "Critique active canvas <slug>"
prompt: structured payload (canvas_path, screenshot_path, feedback, selected, config, output_path, iter_n)
```

`output_path` = `<designRoot>/_history/<slug>/critique/<NNN>-<critic>.md` (NNN auto-incremented).

### 5. Parse verdicts

Each critic emits a JSON verdict block at the end of its report:

```json
{ "agent": "...", "iter": N, "blockers": X, "warnings": Y, "top_blockers": [...], "passed": (X==0) }
```

Orchestrator parses each via `tail` + `jq` or by reading the report and grepping for the last fenced `json` block.

### 6. Consolidate (if > 1 critic)

Write `<designRoot>/_history/<slug>/critique/<NNN>-PANEL.md` (schema in `skills/design/SKILL.md` "Panel consolidation report"):

- TL;DR (total blockers/warnings, verdict)
- Blockers grouped by category, sorted by count
- **Reconciled blocker list** (the reduce-pass output — step 6.1; falls back to the raw grouped list when `orchestration.mode:off`)
- Per-critic table with link to individual report
- Top blockers across panel (sorted: a11y > ds-tokens > others)
- Final JSON verdict block (panel-level)

### 6.1 Reduce-pass — reconcile conflicting blockers (DDR-130)

Today's grouping is a raw *sum* of independent verdicts, so the `/design:edit` loop chases conflicting blockers serially and oscillates (signature-moment adds drama → a11y rejects on contrast → motion re-flags). The reduce-pass collapses that into **one reconciled, ordered blocker list** before the edit loop runs.

Read `orchestration.mode` from `.ai/workflows.config.json` (absent → `auto`). **`mode:off` → skip this step** (the raw grouped list stands; behavior unchanged). Otherwise run **one** consolidator pass (inline or a single subagent) that:

1. **Reads** every critic's emitted verdict JSON + `top_blockers` (read-only over the finished reports).
2. **De-duplicates** blockers multiple critics flag → one entry that lists the flagging critics.
3. **Resolves conflicts** — where fixing critic A's blocker would reintroduce critic B's (contrast ↔ aspiration, density ↔ negative-space, motion ↔ reduced-motion): emit ONE resolution per conflict (which constraint dominates per the DS hard-stops, a11y always wins; or a *conditional* that satisfies both, e.g. "gradient confined to the upper band so the text plate keeps 4.5:1").
4. Emits a single ordered list (a11y > ds-tokens > others, conflicts resolved) into PANEL.md's **Reconciled blocker list**.

**This is the `reduce` tier — strictly read-over-outputs.** It MUST NOT route one critic's report into another critic as a prompt, re-spawn critics, or fabricate a critique — that is the `relay` design-team tier (step 6.2). It only reduces finished verdicts into one coherent list. See `flow:debate-protocol` (reduce-vs-relay).

### 6.2 Relay design-team — live reconciliation (optional — `orchestration.designTeam`)

For maximum reconciliation quality, escalate the reduce-pass to a **live design-team** (**opt-out** — on unless `orchestration.designTeam.enabled` is explicitly `false`) when: native agent-teams capability (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) detected AND the panel produced **≥ `orchestration.designTeam.minConflicts`** cross-discipline conflicting blockers (fixing critic A's reintroduces critic B's). Then, via **`flow:debate-protocol`**, the conflicting critics convene as a native team and **revise their stances after hearing each other** — e.g. `a11y-critic` narrows its contrast constraint to the text band so `signature-moment-critic` can keep the bold hero, and `motion-critic` drops its reduced-motion blocker once the revised moment is compositor-only. The reconciled (often blocker-free) list replaces the step-6.1 output.

This is the ONLY place `/design:critic` uses the `relay` tier; it fires only on genuine cross-discipline conflict (the stakes-gate), never on a single-discipline panel. When `designTeam.enabled` is false or no conflict crosses the threshold, the step-6.1 reduce-pass stands. The team NEVER prompts the user; the reduce-vs-relay line holds — only the native runtime relays.

### 6.5 Record the verdict in the graph (kgai — when active)

`<designRoot>/_history/**` is **gitignored** (DDR-115 runtime-state taxonomy), so a critique — the record of *why* a canvas looks the way it does — never leaves this machine. When the graph is active it becomes the only inheritable copy.

After the reports are final (post-6.1/6.2, so the recorded list is the reconciled one):

```bash
# The consolidated panel — one node per critique run.
maude kg record-log --file "<designRoot>/_history/<slug>/critique/<NNN>-PANEL.md" \
  --kind critic-verdict --about "canvas:<slug>" --link EVALUATES

# Single-critic run (no PANEL written) — record that report instead.
maude kg record-log --file "<designRoot>/_history/<slug>/critique/<NNN>-<critic>.md" \
  --kind critic-verdict --about "canvas:<slug>" --link EVALUATES
```

Record the **panel** when one exists, the single report otherwise — never both, or the same run counts twice. The verb gates itself and is a **silent no-op when the graph is inactive**, so run it unconditionally. It derives a per-canvas slug automatically (`<canvas>-<NNN>-PANEL`) — without that, two canvases' `001-PANEL.md` collapse into one node and the second silently overwrites the first. Contract: **`flow:kgai-backend`**.

### 7. Print summary

```
✓ Panel run on: <canvas>
  Critics ({N}): {list}
  Total blockers: X · Total warnings: Y
  Verdict: {pass | fix-and-retry}

  Top blockers:
  1. [{agent}/{category}] L{N} — {summary}
  …

  Reports: <designRoot>/_history/<slug>/critique/NNN-*
  Panel: <designRoot>/_history/<slug>/critique/NNN-PANEL.md

  Next:
  - If blockers > 0: /design:edit "Address: <top blocker summary>" — or /design:edit "..." --perfect to auto-fix in a loop.
  - If blockers == 0: /design:handoff [--target <label>] when ready.
```

## Failure modes

| Symptom | Action |
|---|---|
| `_active.json` missing / null | fail: "Open a canvas in the browser first." |
| Screenshot cannot be captured (agent-browser unavailable) | critic runs on HTML source only; each critic flags "Visual evidence: HTML source only" in the report header. |
| Tokens CSS unreadable | `design-critic` + `a11y-critic` fail (they need tokens for compliance + contrast). Other critics continue. |
| Critic spawn fail | report the critic as "agent unavailable" in PANEL.md, continue with the rest. |
| `--agent <unknown>` | fail with a list of available critics. |

## Tips

- **Targeted critique** — Cmd+click an element in the canvas, then `/design:critic`. Routing narrows the panel to that element + critics get `selected` in the prompt for element-scoped review.
- **Fast iteration loop** — `/design:edit "..."` (default = 4-iter multi-axis auto-critic with stable-but-bland exit) is faster than `/design:critic` + manual follow-up. `/design:critic` is a standalone audit (no auto-fix).
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
| `signature-moment-critic` | **Aspiration axis** — measures *presence of greatness*, not absence of badness. 5 axes (signature compositional moment per artboard, brand prominence, mock fidelity, restraint, negative space) + specificity gate (no Lorem / placeholders). **Always in panel for `/design:new` and polish-cued `/design:edit`.** Closes the gap between "passes correctness" and "would screenshot for portfolio". |
| `draw-critic` | **Standalone vector art** (logo / icon / illustration / diagram / spot) — 30-check draw rubric with a HARD floor (WCAG · 4/8pt grid · 16px legibility · single-color flatten). Routed when the canvas carries a custom `<svg>` mark or feedback mentions `logo\|icon\|illustration\|diagram\|svg\|vector`. The gap `graphic-design-critic` doesn't cover (it handles the whole-canvas composition, not the mark). |
| `design-system-completeness-critic` | **Structural completeness of the design system itself** — tokens, philosophy, specimens, shape. 3-tier rules (Core blocker / Conventional warning gated by `activeFamilies` + `completenessProfile` / Free-form acknowledged). **Spawned only via `--system-only`** (or auto-run at the end of skill `design-system` bootstrap flow). NOT included in canvas critic panels — different scope. |

Full critic prompts: `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md`.

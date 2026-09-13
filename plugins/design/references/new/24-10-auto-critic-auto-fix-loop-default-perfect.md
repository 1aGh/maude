### 10. Auto-critic + auto-fix loop (default = `--perfect`)

**Same loop algorithm as `/design:edit`** — see SKILL.md "Auto-critic loop". Key difference: `/design:new` has a **higher default bar** than `/design:edit "<feedback>"`, because the scaffold is high-leverage.

**Iter-1 checkpoint — fires only when `opt_out_scope ∈ {aesthetic, full}`.** Before spawning iter-1 critics (after the post-write reality-check screenshots), surface a one-shot AskUserQuestion:

```
Iter 1 ready (opt_out_scope = <scope>). Pick:
  (a) Run the auto-fix loop now — fixes a11y; downgrades DS blockers per scope. (default)
  (b) Show me iter 1, I'll send specific feedback (skip auto-loop this round).
  (c) A11y-only check — skip aspiration + DS, just verify accessibility.
```

This exists because the user signaled exploration — they should get to see iter-1 cheaply before the loop reshapes it. **For `opt_out_scope = palette` (default), do NOT fire this checkpoint** — the existing `--perfect` contract runs unconditionally. Auto Mode (AskUserQuestion denied) → default to (a) and proceed.

**Spawn the panel as one parallel batch.** All critics read the same hot-off-the-press canvas + baseline screenshots — there's no inter-critic dependency within an iteration. **In a single assistant message, spawn the selected panel using parallel Agent tool calls** (4 critics in the default panel; one batch, not four sequential spawns). The `design-system-keeper` from step 9.5 is spawned in this same message (already specified there). The orchestrator merges all verdicts at the end of the iteration.

**Verdict merge uses the orchestration reduce-pass (END adversarial bookend — DDR-130).** When merging the panel's verdicts each iteration, apply the same reconciliation as `/design:critic` step 6.1: one consolidator READS the verdicts and resolves cross-discipline conflicts (contrast ↔ aspiration, density ↔ negative-space, motion ↔ reduced-motion) into **one ordered blocker list**, so the fix loop addresses a coherent list instead of oscillating between conflicting critics across iterations. Unless `orchestration.designTeam.enabled` is explicitly `false` (opt-out — on by default), when native agent-teams capability (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) + ≥ `orchestration.designTeam.minConflicts` conflicting blockers, escalate to the **live design-team** (`/design:critic` step 6.2 relay — critics revise stances after hearing each other). `orchestration.mode:off` → today's raw merge, unchanged. Read-only over verdicts; never hand-roll relay in markdown.

**The iter-1 spawn prompts were already drafted during the step-9 background-screenshot window (Phase C / DDR-061)** — by the time the capture job completes you hold the prepped batch, so iter-1 critic spawn fires immediately after the reality check rather than starting prompt-prep cold.

**Pass `opt_out_scope` AND `ds_fidelity` to every critic in the panel.** Each `Agent` invocation's prompt MUST include both verbatim alongside `canvas_path`, `screenshot_path`, etc. Each critic agent reads `opt_out_scope` and adjusts severity per its own spec — `design-critic` / `graphic-design-critic` / `typography-critic` / `signature-moment-critic` downgrade matching DS-rule blockers to warnings; `a11y-critic` / `frontend-critic` / `copy-critic` ignore the parameter (their blockers are universal). `ds_fidelity` (DDR-141) is consumed by `design-system-keeper` and `brand-critic`: under `strict`, reuse findings (invented brand mark, reinvented component/icon family, parallel shell) arrive as **blockers** and count toward the loop's correctness gate — the loop cannot exit `SOLID` while a shipped specimen stays reinvented. Under `advisory` (default) they stay warnings — today's behavior, zero regression.

**Pass the DS context inline too (B16 — avoid re-reads).** `/design:new` already resolved the design system in step 1. Hand each critic the resolved values in its spawn prompt — `root_class: <ROOT_CLASS>`, `tokens_path: <abs DS_TOKENS>`, `components_css: <abs DS_ROOT/preview/_components.css>`, `ds_root: <abs DS_ROOT>`, `ds_name: <TARGET_DS>`, `theme: <THEME>` — so the critics that need DS conformance context (`design-critic`, `graphic-design-critic`, `typography-critic`) don't each re-`Read` `.design/config.json` + the tokens CSS. Subagents inherit CLAUDE.md + MCP + skills but NOT this conversation, so the resolved DS context must travel in the prompt.

**Panel composition — bar by mode (minimum the orchestrator MUST spawn):**

| Mode | max_iter | aspiration_target | Minimum panel |
|---|---:|---:|---|
| **Default (= `--perfect`)** | **8** | **4.5 / 5** | `signature-moment-critic` + `design-critic` + `frontend-critic` + `a11y-critic` (if interactive) + `brand-critic` (if the DS ships brand assets — step 5a `LOGO_SPECIMEN`/`ICON_SPECIMEN` non-empty; DDR-141) |
| `--perfect --all` | 8 | 4.5 / 5 | **every** critic in `${CLAUDE_PLUGIN_ROOT}/agents/` |
| `--perfect-iter N` | N | 4.5 / 5 | same minimum panel as default |
| `--quick` | 2 | 4.0 / 5 | `signature-moment-critic` only |
| `--no-critic` | 0 | n/a | (skip loop entirely) |

**Single-critic runs are valid only when the `--quick` / `--no-critic` flag is set (user opt-out) or when `/design:critic --agent <name>` is explicitly user-invoked.** Inside the auto-loop a single-critic shortcut is a **process violation**, regardless of justification:

- "I'll just run signature-moment to save tokens" → cost-based skip → violation
- "Would require multiple parallel Agent spawns" → complexity-based skip → violation
- "Same model executes anyway, critics won't help" → quality-prediction-based skip → violation
- "User said brief was a test, probably doesn't need critic" → assumed-intent-based skip → violation

**The default is the contract.** Spec doesn't list "skip if expensive / complex / unlikely to help" as exit conditions. If you predict the loop won't help, that's a spec change to propose, not an orchestrator decision to make mid-run. If the token budget is visibly constrained (context > 60% full), surface a one-shot AskUserQuestion **before** starting the loop — see Failure modes → "--perfect cost when budget tight". Auto Mode (where AskUserQuestion is denied) **does not authorize a skip** — Auto Mode authorizes autonomous decisions on **ambiguous** matters; spec defaults are not ambiguous.

**Stop conditions (per SKILL.md "Auto-critic loop"):**
- `SOLID` — correctness 0 blockers + aspiration ≥ target + specificity pass + stable for 1 iter
- `stable-but-bland` — correctness clean + aspiration plateau below target → exit with diagnostic (lowest 2 axes named)
- `max-reached` — hit `max_iter` before SOLID or stable
- `divergent` — score regressed > tolerance → restore best snapshot, exit
- `validation-failed` — fix iteration broke validation → restore, exit

Bootstrap a chat transcript: write `<DESIGN_ROOT>/_history/<slug>/chat.md` with the brief as iteration 0 (include the screenshot path from step 9), then loop entries as iterations 1..N.

### 8. Auto-critic + auto-fix loop (default — opt out with `--no-critic`)

#### 8a. DS-drift fast-path (token-only fixes)

Before resolving the panel, check whether the user's feedback is a **DS-drift complaint** — a request to undo token misuse, not a request for new design work. The conservative regex below matches feedback that *explicitly* names the design system or DS drift:

```bash
DRIFT_FEEDBACK=0
if grep -qiE '\b(design[ -]?system|DS)[ -](drift|color[s]?|barv[ay]|barev)\b|\bjiné barvy než (DS|design system)\b|\b(wrong|different) (colors?|tokens?) (than|from) (DS|design system|the system)\b|\bDS drift\b' <<< "$FEEDBACK"; then
  DRIFT_FEEDBACK=1
fi
```

**Conservative by design.** Generic color comments ("the green here feels off", "tighter palette") are NOT DS-drift complaints — they're aesthetic feedback that wants the full critic panel. The regex requires explicit "DS" / "design system" / Czech "jiné barvy než DS" wording. On ambiguity, fall through to the default routing.

**When `DRIFT_FEEDBACK=1`:** route a stripped panel — `[design-system-keeper, design-critic]` only — and cap the loop at **2 iterations**. Reasoning: DS drift fixes are deterministic find-and-replace once ds-keeper surfaces the mismatch — no aspiration / signature / a11y reverification needed beyond what `design-critic` already does inline. This skips 4–6 critic spawns per iteration vs the default panel.

If the fast-path runs but ds-keeper produces 0 token-usage findings, the orchestrator surfaces a one-line note ("ds-keeper found no DS drift — falling through to standard panel for iter 2") and proceeds with the default routing for the next iteration.

#### 8b. Standard routing

**Resolve opt-out scope first.** Order: (1) `--opt-out=<scope>` flag in `$ARGUMENTS` wins; (2) else read `<active>.meta.json` `opt_out_scope` field; (3) else the DS default from `config.aestheticAmbition` (DDR-073 — `maximalist` → `full`, `expressive` → `aesthetic`, `restrained`/`confident`/missing → `palette`), via `jq -r '.aestheticAmbition // "restrained"' "${DESIGN_ROOT:-.design}/config.json"`; (4) else default `palette`. Pass the resolved scope to every critic in the panel via the input envelope. Each critic adjusts severity per its own spec — `design-critic` / `graphic-design-critic` / `typography-critic` / `signature-moment-critic` downgrade matching DS-rule blockers to warnings; `a11y-critic` / `frontend-critic` / `copy-critic` ignore the parameter (their blockers are universal). Persist the resolved scope back to `.meta.json` if it changed.

**Resolve `ds_fidelity` alongside it (DDR-141):** `jq -r '.dsFidelity // "advisory"'` from `.design/config.json`; a resolved scope of `full` overrides to `advisory` (explicit free-use beats project policy — one axis, not two competing switches). Pass it to `design-system-keeper` + `brand-critic` in the same envelope: under `strict`, their reuse findings (invented brand mark, reinvented component/icon family, parallel shell) are **blockers** that count toward the loop's correctness gate; under `advisory` (default) they stay warnings — today's behavior.

**See `skills/design/SKILL.md` "Auto-critic loop" + "Opt-out scope" for full spec.** Key points:

| Flag | max_iter | aspiration_target | Panel | Use |
|---|---|---|---|---|
| (default) | 4 | 4.0 / 5 | routed (incl. `signature-moment-critic` when feedback contains polish/nicer/elegant cues) | every /design:edit — solid-for-review |
| `--no-critic` | 0 | n/a | (skip) | quick / dirty edit |
| `--perfect [N]` | N (default 8) | 4.5 / 5 | routed | extended polish, broader scope |
| `--perfect --all` | N | 4.5 / 5 | every critic incl. aspiration | exhaustive / portfolio-grade |
| `--opt-out=<scope>` | (orthogonal) | (orthogonal) | (orthogonal) | Override scope for this iteration. `palette` (default) / `aesthetic` (palette + gradients/radii free) / `full` (DS advisory). A11y enforced regardless. Persists to `.meta.json`. |
| `--skip-ds-keeper` | (orthogonal) | (orthogonal) | (orthogonal) | Skip the `design-system-keeper` precheck (step 7.5). Use for known-experimental edits where reinvention is intent. |

Default loop **multi-axis** stop condition: `correctness == 0 AND aspiration ≥ 4.0 AND specificity == "pass" AND no_gains_for_1_round`. When it plateaus → exit `stable-but-bland` with a diagnostic (lowest 2 axes), instead of silent success on "blockers == 0 but bland."

**Per iteration, decide the panel set first, then spawn it in one parallel batch.** The decision block selects which critics run:

1. **`DRIFT_FEEDBACK=1`** (step 8a) → `[design-system-keeper, design-critic]`, cap 2 iter.
2. **else** → the routed panel from the table above (default 4-critic set; add `signature-moment-critic` when feedback carries polish/nicer/elegant cues; `--perfect --all` → every critic).
3. **`design-system-keeper`** (step 7.5) joins the same batch when `RUN_KEEPER=1`.

Then: **spawn the selected set in a single assistant message using parallel Agent tool calls** → parse JSON verdicts → write NNN-PANEL.md → check exit conditions → auto-fix top 3 blockers → repeat. Even when the selected set is a single critic, keep the explicit "spawn in parallel" framing so the habit holds. Track best snapshot, restore on divergence.

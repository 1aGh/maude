### 9.5. Design-system keeper precheck

**Auto-routed by default** — between the post-write reality-check screenshots (step 9) and the critic panel (step 10). Skip with `--skip-ds-keeper` if the user has explicitly opted out (rare — primarily known-experimental canvases or debug runs).

The `design-system-keeper` agent runs two read-only passes — pattern-reinvention scan + token-usage audit — over the just-generated canvas. Findings are warnings (not blockers) by default; the agent self-promotes to blocker only when ≥ 5 token mismatches OR ≥ 3 pattern reinventions stack on this canvas (mass-drift signals). Findings feed into the critic panel as additional context — the panel's own critics can promote to their own blockers if the surrounding context warrants.

**Spawn in parallel with step 10** — the panel doesn't wait on ds-keeper to start; both run concurrently, the orchestrator merges verdicts at the end of the iteration. This keeps the wall-clock cost of the precheck near-zero relative to the panel.

```bash
# Skip if --skip-ds-keeper flag was passed.
if grep -q -- '--skip-ds-keeper' <<< "$ARGS"; then
  echo "→ ds-keeper precheck skipped per --skip-ds-keeper flag"
else
  # <n> is the critic round this keeper verdict belongs to (0 for the first).
  mkdir -p "$RUN/critique"
  KEEPER_OUT="$RUN/critique/keeper-0.json"

  # Collect existing canvases in the same DS (excludes the new canvas).
  EXISTING_JSON=$(find "$DESIGN_ROOT/$NEW_CANVAS_DIR" -maxdepth 2 -name "*.tsx" \
                    -not -path "*$TARGET_PATH*" \
                    | jq -R . | jq -sc .)
fi
```

```
# Spawn ds-keeper in parallel with the critic panel (step 10) — single message, multiple Agent calls.
Agent(
  description: "DS keeper precheck for <Name>",
  subagent_type: "design:design-system-keeper",
  prompt: <<EOF
canvas_path:             "<abs path to TARGET_PATH>"
ds_root:                 "<abs path to DS_ROOT>"
existing_canvases:       <EXISTING_JSON>
preview_components_root: "<abs path to DS_ROOT/preview>"
platform_showcase_path:  "<abs path to SHOWCASE_PATH from step 5a, or empty if none>"
brand_logo_path:         "<abs path to LOGO_SPECIMEN from step 5a, or empty if none>"
brand_iconography_path:  "<abs path to ICON_SPECIMEN from step 5a, or empty if none>"
opt_out_scope:           "<SCOPE from step 4>"
ds_fidelity:             "<DS_FIDELITY from step 4>"
token_guide_path:        "<abs path to DS_ROOT/README.md>"
iter_n:                  1
EOF
)
```

The keeper is read-only: it returns its verdict JSON in its final message, and you save that to `$KEEPER_OUT` so the critics get it in their hand-off `reads`. It never writes a file. The orchestrator merges the verdict's `top_warnings` into the iter-1 critic-panel summary so the user sees one consolidated view.

**If ds-keeper self-promoted to blocker** (≥ 5 token mismatches OR ≥ 3 pattern reinventions stacked) → the orchestrator surfaces this in the iter-1 print as `ds-keeper: BLOCKER (mass drift detected — see <KEEPER_OUT>)` and the auto-fix loop's first iteration prioritizes ds-keeper findings before any other critic's blockers. This catches mass-drift early — before the panel chases symptom-level fixes.

**Failure handling:**
- Agent fails entirely (no verdict returned) → **do not block the panel**. Surface a warning in the final print (`ds-keeper precheck failed — DS-fidelity audit unavailable for this iteration`) and let the panel proceed.
- Verdict malformed → treat as no findings, and say so in the final print.

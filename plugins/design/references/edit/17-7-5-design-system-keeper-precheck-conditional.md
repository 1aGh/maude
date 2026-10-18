### 7.5. Design-system keeper precheck (conditional)

**Auto-routed when the diff is substantial.** The `design-system-keeper` agent (read-only) audits the just-edited canvas for two failure modes — pattern reinvention (lifting existing canvas shapes instead of inventing parallel ones) and token-usage drift (using a token in the wrong role per the DS Token usage guide). The retro at `.ai/logs/system-reviews/docs-site-design-generation-review.md` is the source of this step.

Unlike `/design:new` (where ds-keeper always fires), `/design:edit` runs ds-keeper **only when the iteration is non-trivial** — to avoid spawn cost on every single-line tweak. Triggers:

- **≥ 10 lines changed** by your edits in this round (count the lines of the `new_string` of each Edit you made), OR
- **Any new class root appears** that the canvas did not use before (a new compositional element added). The file as it was is in the version before this run: `maude design history list "$ACTIVE_REL" --limit 1`, then `maude design history show <ref>`. For a small edit you already know what you added.

```bash
# Skip if --skip-ds-keeper flag was passed.
if grep -q -- '--skip-ds-keeper' <<< "$ARGUMENTS"; then
  echo "→ ds-keeper precheck skipped per --skip-ds-keeper flag"
  RUN_KEEPER=0
else
  # CHANGED_LINES: the lines your Edit calls wrote. NEW_CLASSES: class roots they introduced.
  if [ "$CHANGED_LINES" -ge 10 ] || [ "$NEW_CLASSES" -gt 0 ]; then
    RUN_KEEPER=1
  else
    RUN_KEEPER=0
    echo "→ ds-keeper precheck skipped ($CHANGED_LINES lines, $NEW_CLASSES new class roots — below trigger threshold)"
  fi
fi
```

When `RUN_KEEPER=1`, spawn ds-keeper in parallel with the critic panel (step 8), same envelope shape as `/design:new` step 9.5. The keeper is read-only and returns its verdict JSON in its final message: save it to `$RUN/critique/keeper-<n>.json` (`<n>` is the critic round) so the critics get it in their hand-off `reads`. Findings merge into the iter-1 panel summary; self-promoted blockers (mass drift) get priority in the auto-fix loop. Same failure handling as `/design:new` step 9.5 — agent failure does not block the panel.

**Pass `platform_showcase_path` + the DDR-141 brand/fidelity inputs to the keeper** so Pass A.6 (product-shell reuse, DDR-127) and Pass A.8 (brand-asset reuse, DDR-141) can check whether a substantial edit reinvented the shell or the brand identity. Resolve them cheaply here even when the step-1.5 pre-loads didn't run (a non-add-surface edit can still cross the diff threshold):

```bash
SC_DS=$(jq -r '.designSystem // "project"' "$META_PATH" 2>/dev/null || echo "project")
SC_PLATFORM=$(jq -r '.platform // "desktop"' "$META_PATH" 2>/dev/null || echo "desktop")
[ "$SC_PLATFORM" = "tablet" ] && SC_PLATFORM="mobile"
SC_PREVIEW=$(jq -r ".designSystems[] | select(.name==\"$SC_DS\") | .path" "$CFG" 2>/dev/null || echo "system/$SC_DS")
KEEPER_SHOWCASE=$(ls "$REPO_ROOT/$DESIGN_ROOT/$SC_PREVIEW/preview/ui_kits-${SC_PLATFORM}-showcase.tsx" 2>/dev/null | head -1)
[ -z "$KEEPER_SHOWCASE" ] && KEEPER_SHOWCASE=$(ls "$REPO_ROOT/$DESIGN_ROOT/$SC_PREVIEW/preview/ui_kits-"*-showcase.tsx 2>/dev/null | head -1)

# DDR-141 — brand specimens + fidelity policy (scope full overrides strict; see /design:new step 4)
KEEPER_LOGO=$(ls "$REPO_ROOT/$DESIGN_ROOT/$SC_PREVIEW/preview"/logo.{tsx,jsx,svg,html} 2>/dev/null | head -1)
KEEPER_ICON=$(ls "$REPO_ROOT/$DESIGN_ROOT/$SC_PREVIEW/preview"/iconography.{tsx,jsx,html} 2>/dev/null | head -1)
DS_FIDELITY=$(jq -r '.dsFidelity // "advisory"' "$CFG" 2>/dev/null || echo advisory)
# Scope may not be resolved yet at 7.5 (full resolution order lives in 8b) — read the
# same sources here: --opt-out flag wins, else the canvas sidecar; default palette.
K_SCOPE=$(grep -oE -- '--opt-out=(palette|aesthetic|full)' <<< "$ARGUMENTS" | cut -d= -f2)
[ -z "$K_SCOPE" ] && K_SCOPE=$(jq -r '.opt_out_scope // "palette"' "$META_PATH" 2>/dev/null || echo palette)
[ "$K_SCOPE" = "full" ] && DS_FIDELITY="advisory"
# Add to the keeper-spawn prompt:
#   platform_showcase_path: "$KEEPER_SHOWCASE"   (empty → Pass A.6 no-ops)
#   brand_logo_path:        "$KEEPER_LOGO"       (empty → Pass A.8 no-ops)
#   brand_iconography_path: "$KEEPER_ICON"
#   opt_out_scope:          "$K_SCOPE"
#   ds_fidelity:            "$DS_FIDELITY"
```

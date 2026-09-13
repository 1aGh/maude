### 7. Post-write reality check — confirmation screenshot

**Always fires, regardless of `--no-critic`.** Reality check (does the file render?), ne quality check.

> **Activity overlay (Phase 13 / DDR-029).** While each Edit/Write lands, any open canvas tab shows a live "editing — `<file>`" overlay (pulsing rim + corner badge) on the affected artboard(s), then cross-fades out ~3 s after the last write. It's fs-watch-driven and automatic — no action required. Exports and `hide-chrome` captures suppress it; the peripheral rim doesn't obstruct the reality-check screenshot.

**Background overlap (Phase C / DDR-061).** When the critic panel will run (not `--no-critic`), fire this capture as a **background Bash call** (`run_in_background: true`) and spend the wait on step-8 prep — resolving the opt-out scope, the routed panel set (8a/8b decision), the per-critic inline DS context (already cached from step 1.5), and the `RUN_KEEPER` ds-keeper context. Hold the batch ready; when the background job completes you are notified (do **not** poll/sleep), then `Read` the PNG for the reality check and spawn the prepped panel. The CSS-mtime `touch` below must happen **before** the capture is launched, so do it first, then background the screenshot. If `run_in_background` is unavailable, fall back to the synchronous capture — it just blocks — and prep afterward. (`--no-critic` runs the capture synchronously; there's no panel to overlap with.)

```bash
# D-2 — if the active canvas is css_mode with a sibling <slug>.css that we just
# edited, bump the .tsx mtime so canvas-build re-inlines the CSS BEFORE the
# screenshot (the bundle cache keys on the .tsx mtime; a CSS-only edit is
# otherwise invisible until restart). No-op when there's no sibling .css.
ABS_ACTIVE="$REPO_ROOT/$DESIGN_ROOT/${ACTIVE#$DESIGN_ROOT/}"
SIBLING_CSS="${ABS_ACTIVE%.tsx}.css"
if [ "${ACTIVE##*.}" = "tsx" ] && [ -f "$SIBLING_CSS" ]; then
  touch "$ABS_ACTIVE" && echo "→ touched $(basename "$ABS_ACTIVE") to re-inline sibling CSS"
fi

OUT="$DESIGN_ROOT/_history/$SLUG/$NNN-baseline.png"
maude design screenshot --full --out "$OUT" \
  || echo "⚠ baseline screenshot not written"
```

The helper resolves the URL from `_server.json` + `_active.json`, polls for canvas mount, picks the engine (agent-browser > playwright fallback). Diagnostics on stderr.

The screenshot path is referenced in the final print + chat.md row. If it renders blank → warn `⚠ canvas rendered blank — likely JSX error`, don't abort (the file exists, the user can open it manually).

Detaily: SKILL.md "Post-write reality check".

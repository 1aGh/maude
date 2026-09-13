### 9. Post-write reality check — per-artboard screenshots

**Always fires, regardless of `--no-critic`.** Reality check, not a quality check. Capture via agent-browser against the server URL (not `file://`). **Per-artboard screenshot is a BLOCKER condition for `/design:new`, not a footnote** — system-review 2026-05-27 (D-2) flagged that single-PNG fallbacks > 5 MB silently bypass visual verification, and per-screen failures used to be logged as `⚠` and continued. New contract: per-screen succeeds, OR the loop halts and surfaces an AskUserQuestion.

**Dual-theme DSes get a SECOND full pass in the alternate theme (2026-07-08).** When step 1 resolved `ALT_THEME` (non-empty — `DS_THEMES` declared more than one theme), a canvas is not visually verified until BOTH themes have been captured and read. This closes the exact gap a studyfi-v3 system-review caught: a canvas that renders fine in dark shipped with near-invisible light-theme text (a token frozen at its `:root` default, never redeclared inside `[data-theme="light"]`) because only the pinned default theme was ever screenshotted — the light-theme regression was found by a human manually toggling the theme, after critics had already passed. If `ALT_THEME` is empty (single-theme DS, or a legacy DS entry with no `themes[]` declared), this second pass is skipped entirely — no behavior change from before this fix.

> **Activity overlay (Phase 13 / DDR-029).** As the canvas file is written, any open tab shows a live "editing — `<file>`" overlay (pulsing rim + corner badge) on the affected artboard(s), fading out ~3 s after the last write. Automatic, fs-watch-driven, no action required; `hide-chrome` / export captures suppress it.

**Per-artboard element screenshots are the default for `/design:new`** because new canvases are typically multi-artboard (3–8) and DesignCanvas's pan/zoom viewport means a single full-page snapshot misses everything outside the visible viewport. The canonical screenshot helper handles navigation, mount-poll, per-screen loop, and the agent-browser CLI gotchas in one call:

**Background overlap (Phase C / DDR-061).** Fire the per-artboard capture with `run_in_background: true` and spend the wait window on critic-prompt prep — capturing screenshots and *building* the critic spawn prompts have no data dependency. Concretely:

1. Launch the `screenshot.sh --all-screens` call below as a **background Bash call** (`run_in_background: true`). Do not block on it — this now includes the alternate-theme pass when `ALT_THEME` is set (both passes run inside the same backgrounded call).
2. While it runs, do the prep that step 9.5 + step 10 would otherwise do *after* the capture: collect the ds-keeper `EXISTING_JSON`, resolve each critic's inline DS context (`root_class` / `tokens_path` / `components_css` / `ds_root` — already cached from step 1.5), read `<Name>.meta.json`, and draft each per-critic spawn prompt. Hold the batch ready.
3. When the background screenshot job completes you are notified — **do not poll or sleep**. Then `Read` the PNGs from BOTH theme passes for the reality check (not just the default-theme set), run the step-9 FAIL/partial handling, and spawn the prepped critic batch (step 10), which consumes those screenshot paths.

This hides the ~3–5 s capture inside the prompt-prep window (validation target 3: scaffold→critic-spawn within ~200 ms of prep-alone time). The step-9 BLOCKER contract is unchanged — it just evaluates after the job completes, not inline. **If `run_in_background` is unavailable** (restrictive sandbox / permission mode), fall back to the synchronous capture below — identical recipe, it just blocks — and do the prep afterward.

```bash
HIST="$DESIGN_ROOT/_history/$SLUG"
mkdir -p "$HIST"

# Default-theme pass — preferred engine.
maude design screenshot \
  --all-screens \
  --out-dir "$HIST" \
  --timeout 10
PER_SCREEN_EXIT=$?

# Engine fallback — playwright (only when the default-theme pass failed).
if [ "$PER_SCREEN_EXIT" -ne 0 ]; then
  echo "→ agent-browser per-screen failed; retrying with playwright engine" >&2
  maude design screenshot \
    --all-screens \
    --engine playwright \
    --out-dir "$HIST" \
    --timeout 15
  PER_SCREEN_EXIT=$?
fi

# Alternate-theme pass — only when step 1 resolved ALT_THEME (dual-theme DS).
# Writes into its own subdir so neither pass's filenames collide.
ALT_SCREEN_EXIT=0
if [ -n "$ALT_THEME" ]; then
  ALT_HIST="$HIST/theme-$ALT_THEME"
  mkdir -p "$ALT_HIST"
  maude design screenshot \
    --all-screens \
    --theme "$ALT_THEME" \
    --out-dir "$ALT_HIST" \
    --timeout 10
  ALT_SCREEN_EXIT=$?
  if [ "$ALT_SCREEN_EXIT" -ne 0 ]; then
    echo "→ agent-browser alt-theme per-screen failed; retrying with playwright engine" >&2
    maude design screenshot \
      --all-screens \
      --theme "$ALT_THEME" \
      --engine playwright \
      --out-dir "$ALT_HIST" \
      --timeout 15
    ALT_SCREEN_EXIT=$?
  fi
fi
```

The helper:

- Resolves URL from `_server.json` + `_active.json` (no manual port/URL math).
- Polls for `[data-dc-screen]`/`[data-dc-slot]` mount up to `--timeout`s (Babel/React canvases need 2–4 s).
- Scrolls each artboard into view (defeats `DesignCanvas` pan/zoom lazy-mount) and captures `<HIST>/<NNN>-screen-<id>.png`.
- Picks engine `agent-browser` > `playwright` fallback automatically when `--engine auto`; explicit `--engine playwright` forces the second-pass shim.
- Stdout = written paths (one per line); diagnostic + engine choice in stderr.
- `--theme <name>` (used only for the alternate-theme pass above) forces every `[data-theme]` element to that value via a DOM eval before capturing — it does not touch the canvas file, so the default-theme pass and any later interactive session are unaffected.

**Why per-artboard wins for canvases (retro 2026-05-09).** During the iOS Bikeshare Signup session, full-page snapshots showed only 1 of 6 artboards because DesignCanvas pans/zooms its world independently of document scroll. `[data-dc-screen]` element screenshots captured all 6 cleanly. See SKILL.md "Post-write reality check" for the full explanation.

**Per-screen FAIL handling — both engines exhausted (`PER_SCREEN_EXIT ≠ 0`):**

Do NOT silently fall back to a single full-page PNG. The full-page fallback produces 30–60 MB images for multi-artboard canvases — too large for the orchestrator to Read into context, so "verification" becomes a path string the agent never inspected. System-review 2026-05-27 (D-2) flagged this as the root of "mobile artboards reported missing even though authored". Instead, surface a one-shot AskUserQuestion:

```
Per-artboard screenshot failed on both agent-browser and playwright engines.
The canvas TSX wrote cleanly; this is a visual-verification gap, not a render
failure. Pick:
  (a) Retry once — sometimes a fresh /_health + mount poll succeeds. (default)
  (b) Launch agent-browser interactively — I'll open the URL and you tell me
      what you see; I'll continue based on your readout.
  (c) Accept the gap as known-unverified — proceed to the critic panel
      WITHOUT a baseline screenshot. The print step will flag this loud.
  (d) Abort /design:new — don't continue without visual confirmation.
```

Auto Mode (AskUserQuestion denied) → default to (c) but **the final print MUST stamp `⚠ visual verification SKIPPED — per-artboard capture failed on both engines; canvas IA was not visually confirmed`** so the user sees the gap before they discover it via "where are the mobile screens?". The critic panel runs WITHOUT a baseline screenshot path; signature-moment-critic and design-critic both flag absent baseline as a warning.

**Per-screen partial fail (some IDs captured, some failed):** Helper returns the captured paths on stdout and exit 3. Treat this as success-with-gap — record which artboard IDs failed in the print + chat.md iter-0 row; do NOT auto-retry the failed IDs (signal that those artboards have render issues worth investigating manually).

**If blank render / timeout on ALL artboards** → warn `⚠ canvas rendered blank — likely JSX error`. Don't auto-rollback (user can open browser + see console). This screenshot's path (or the absent-baseline marker) goes into the final print + chat.md iteration 0 row.

**Alternate-theme FAIL handling (`ALT_SCREEN_EXIT ≠ 0`, both engines exhausted):** the default-theme baseline still exists, so this is not a full-abort condition the way the primary pass is — but it must not resolve to silent-pass either, since an un-audited theme is exactly how the studyfi-v3 regression shipped. Surface the same one-shot AskUserQuestion as the primary FAIL path (§ above), reworded for the alternate theme, with the same four options; **Auto Mode defaults to (c)** and the final print MUST stamp `⚠ <ALT_THEME>-theme visual verification SKIPPED — canvas was only confirmed in <THEME>; the DS declares both as co-equal`. The critic panel still runs (it has the default-theme baseline), but `design-critic` treats a missing alternate-theme baseline on a declared-dual-theme DS as a warning it cannot silently drop, the same way it treats an absent default-theme baseline today.

**Alternate-theme partial fail (some IDs captured, some failed):** same contract as the primary pass — record which artboard IDs failed in the print + chat.md iter-0 row, don't auto-retry.

**No `--full` shortcut for ≤ 3 artboards.** The single-PNG path was removed per system-review D-2 — even 1 artboard at 1200×760 with a full page panable canvas can produce a misleading PNG (offscreen content cropped, transform state ambiguous). The per-screen path is mandatory; if it fails, the AskUserQuestion above is the only escape hatch.

Detaily a failure handling: SKILL.md "Post-write reality check".

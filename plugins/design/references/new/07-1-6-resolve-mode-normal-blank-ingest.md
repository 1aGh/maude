### 1.6 Resolve mode (normal · blank · ingest)

Parse the mode flags from `$ARGS` and inspect the **active** canvas. `prep.sh --shape new` deliberately omits the active-canvas block, so read `_active.json` directly here (a single jq read, independent of prep's shape):

```bash
BLANK=0; FROM_ANNOTATIONS=0; FRESH=0
grep -q -- '--blank'            <<< "$ARGS" && BLANK=1
grep -q -- '--from-annotations' <<< "$ARGS" && FROM_ANNOTATIONS=1
grep -q -- '--fresh'            <<< "$ARGS" && FRESH=1

# Active canvas (design-root-relative). `.active` may carry a leading designRoot/
# prefix — strip it so it matches what the reader + slug helper expect.
ACTIVE_CANVAS=$(jq -r '.active // empty' "$REPO_ROOT/$DESIGN_ROOT/_active.json" 2>/dev/null)
ACTIVE_REL="${ACTIVE_CANVAS#"$DESIGN_ROOT"/}"; ACTIVE_REL="${ACTIVE_REL#./}"

INGEST=0; ANNOT_JSON='[]'; ANNOT_COUNT=0; ACTIVE_KIND="canvas"
if [[ "$BLANK" -eq 0 && -n "$ACTIVE_REL" ]]; then
  ACTIVE_ABS="$REPO_ROOT/$DESIGN_ROOT/$ACTIVE_REL"
  ACTIVE_META="${ACTIVE_ABS%.tsx}.meta.json"
  ACTIVE_KIND=$(jq -r '.kind // "canvas"' "$ACTIVE_META" 2>/dev/null || echo canvas)
  # One reader call does BOTH non-empty detection AND yields the strokes step 6b
  # composes the brief from — no second read. (DDR-062: maude design <verb>.)
  ANNOT_JSON=$(maude design read-annotations "$ACTIVE_REL" --root "$REPO_ROOT" 2>/dev/null || echo '[]')
  ANNOT_COUNT=$(jq 'length' <<< "$ANNOT_JSON" 2>/dev/null || echo 0)
  TEXT_COUNT=$(jq '[.[] | select(.text != null and (.text | length) > 0)] | length' <<< "$ANNOT_JSON" 2>/dev/null || echo 0)
  if [[ "$FRESH" -eq 0 ]]; then
    if [[ "$FROM_ANNOTATIONS" -eq 1 ]]; then
      INGEST=1
    elif [[ "$ACTIVE_KIND" == "brief-board" && "$ANNOT_COUNT" -gt 0 ]]; then
      INGEST=1
    fi
  fi
fi
```

| Resolved | Go to |
|---|---|
| `BLANK=1` | **step 3** (resolve a NEW target path) → **step 3.5** (write the board, set active, exit). Skips 3.6, 4–10 entirely; step 2 (server-up) is optional. |
| `INGEST=1` | **step 6b** (read annotations → compose verbatim brief → generate → Edit into the **active** canvas). Step 3's new-path resolution is SKIPPED — ingest writes into the active file. The critic loop (step 10) still runs on the inserted artboards. Keep step 2 (the result must render). |
| neither | normal flow — steps 2 → 12 unchanged. |

**Edge cases:**

- `--from-annotations` on an active canvas whose annotation layer is empty (`ANNOT_COUNT == 0`) → warn `⚠ --from-annotations: <ACTIVE_REL> has no annotations to ingest; nothing to do` and **exit**.
- `--fresh` while an ingest would otherwise have fired → print `→ --fresh: ignoring <ANNOT_COUNT> annotations on <ACTIVE_REL>; scaffolding a new file` and continue normal.
- Ingest auto-detected (`brief-board` + strokes) but **no text-bearing** strokes (`TEXT_COUNT == 0`, only arrows/shapes) → the board has shapes but no words. If a `"<brief>"` was passed on the command line, use it as the generation brief and note `→ board has <ANNOT_COUNT> annotation(s) but no text; generating from the command-line brief instead`. If no brief either → warn `⚠ <ACTIVE_REL> has only non-text annotations and no brief was given; nothing to generate` and exit.
- No active canvas at all (`ACTIVE_REL` empty) and no `--blank` → normal flow (this is the classic "scaffold a new canvas from a name+brief").

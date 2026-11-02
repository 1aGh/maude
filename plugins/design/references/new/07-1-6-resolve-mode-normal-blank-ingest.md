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

INGEST=0; ANNOT_JSON='{"elements":[]}'; ANNOT_COUNT=0; ACTIVE_KIND="canvas"; IS_BRIEF=0
if [[ "$BLANK" -eq 0 && -n "$ACTIVE_REL" ]]; then
  ACTIVE_ABS="$REPO_ROOT/$DESIGN_ROOT/$ACTIVE_REL"
  ACTIVE_META="${ACTIVE_ABS%.tsx}.meta.json"
  ACTIVE_KIND=$(jq -r '.kind // "canvas"' "$ACTIVE_META" 2>/dev/null || echo canvas)
  # The brief canvas is the one kind that is none of the others in the meta schema
  # (canvas · specimen · imported-figma · reconstructed-experimental · video-comp):
  # read the kind, don't spell the brief canvas's own id here.
  case "$ACTIVE_KIND" in
    canvas|specimen|imported-figma|reconstructed-experimental|video-comp) ;;
    *) IS_BRIEF=1 ;;
  esac
  # One reader call does BOTH non-empty detection AND yields the elements step 6b
  # composes the brief from — no second read. (DDR-062: maude design <verb>.)
  # Sections NEST their members (DDR-242), so count by walking the tree.
  ANNOT_JSON=$(maude design read-annotations "$ACTIVE_REL" --root "$REPO_ROOT" 2>/dev/null || echo '{"elements":[]}')
  ANNOT_COUNT=$(jq '[.elements | .. | objects | select(.type)] | length' <<< "$ANNOT_JSON" 2>/dev/null || echo 0)
  TEXT_COUNT=$(jq '[.elements | .. | objects | select(.type and (.text // "" | length) > 0)] | length' <<< "$ANNOT_JSON" 2>/dev/null || echo 0)
  if [[ "$FRESH" -eq 0 ]]; then
    if [[ "$FROM_ANNOTATIONS" -eq 1 ]]; then
      INGEST=1
    elif [[ "$IS_BRIEF" -eq 1 && "$ANNOT_COUNT" -gt 0 ]]; then
      INGEST=1
    fi
  fi
fi
```

| Resolved | Go to |
|---|---|
| `BLANK=1` | **step 2** (the studio must be running: the create goes through it) → **step 3** (the name, folder and system only; its create call is normal mode's) → **step 3.5** (make the brief canvas, open it, exit). Skips 3.6, 4–10 entirely. |
| `INGEST=1` | **step 6b** (read annotations → compose verbatim brief → draft → Edit into the **active** canvas). Step 3's name and create are SKIPPED — ingest edits the active canvas. The critic loop (step 10) still runs on the inserted artboards. Keep step 2 (the result must render). |
| neither | normal flow — steps 2 → 12 unchanged. |

**Edge cases:**

- `--from-annotations` on an active canvas whose annotation layer is empty (`ANNOT_COUNT == 0`) → warn `⚠ --from-annotations: <ACTIVE_REL> has no annotations to ingest; nothing to do` and **exit**.
- `--fresh` while an ingest would otherwise have fired → print `→ --fresh: ignoring <ANNOT_COUNT> annotations on <ACTIVE_REL>; making a new canvas` and continue normal.
- Ingest auto-detected (a brief canvas + elements) but **no text-bearing** elements (`TEXT_COUNT == 0`, only arrows/pen/unlabelled shapes) → the canvas has shapes but no words. If a `"<brief>"` was passed on the command line, use it as the generation brief and note `→ <ANNOT_COUNT> annotation(s) but no text; drafting from the command-line brief instead`. If no brief either → warn `⚠ <ACTIVE_REL> has only non-text annotations and no brief was given; nothing to generate` and exit.
- No active canvas at all (`ACTIVE_REL` empty) and no `--blank` → normal flow (this is the classic "make a new canvas from a name+brief").

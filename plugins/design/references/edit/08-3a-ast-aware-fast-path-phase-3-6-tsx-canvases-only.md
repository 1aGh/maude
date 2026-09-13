### 3a. AST-aware fast-path (Phase 3.6 — TSX canvases only)

**Trigger:** all four conditions true:

1. Active canvas extension is `.tsx` (TSX format, two-pass pipeline emits `data-cd-id`).
2. `_active.json.selected.v === 2` AND `_active.json.selected.id` is set (the user Cmd+Clicked an element that carries a pipeline-emitted `data-cd-id`).
3. Feedback names a **single-element single-attribute** change. Heuristic — the feedback contains exactly one of: a class change ("make this `<X>`-class", "set className to …", "switch to `.btn--ghost`"), a style swap ("change padding to 14", "color → amber", "border-radius 8"), or a plain string-attribute set ("aria-label X", "title X").
4. The change is **non-structural** — feedback doesn't insert, delete, or reorder elements.

When all four fire, skip the full-file `Edit`/`Write` of step 5 + the post-edit `grep` validation of step 6 (the surgical edit can't break tokens or rootClass — it only touches one attribute). Instead:

```bash
ACTIVE_EXT="${ACTIVE##*.}"
SEL_V=$(jq -r '.selected.v // 0'   "$DESIGN_ROOT/_active.json")
SEL_ID=$(jq -r '.selected.id // empty' "$DESIGN_ROOT/_active.json")

if [ "$ACTIVE_EXT" = "tsx" ] && [ "$SEL_V" = "2" ] && [ -n "$SEL_ID" ] && [ "$AST_EDIT_OK" = "1" ]; then
  # $ATTR + $NEW_VALUE come from interpreting the feedback. Examples:
  #   ATTR=className   NEW_VALUE="btn btn--ghost"
  #   ATTR=style.color NEW_VALUE='"#facc15"'   # JS expression for style.*
  #   ATTR=aria-label  NEW_VALUE="Save changes"
  maude design canvas-edit \
       "$ACTIVE" "$SEL_ID" "$ATTR" "$NEW_VALUE"
  AST_EDITED=1
fi
```

`canvas-edit.sh` exits 0 on a successful (or no-op) edit and prints one JSON line — `{"canvas": "...", "id": "...", "delta": <int>}`. On any failure (id not in source, parse error, unsupported attribute shape) it exits 2 and writes a readable error to stderr; in that case fall through to the canvas-wide path (step 5).

**When AST fast-path runs**, the orchestrator still:

- Takes the step-4 snapshot (single-line edits are still rollback-able).
- Runs the step-7 post-write reality-check screenshot (the change still needs to render).
- Routes to the critic panel per step 8 (the panel reads screenshots, not source — format-blind).
- Refreshes docs per step 9.

It skips:

- Step 5 (full-file Read + Edit/Write — the AST helper already applied the change).
- Step 6's `grep` validation — surgical attribute swaps can't move the tokens link or the rootClass.
- The step-3.5 element-focused screenshot (the AST path already knows the exact target).

**When the AST path does NOT run** (no selection, v=1 selection, multi-element feedback, structural change), fall through to step 3.5 + step 5 unchanged.

**Motion-role feedback shortcut (Phase 3.7 / DDR-049).** When feedback names a motion role (`"make the panel snappier"`, `"slower flip"`, `"this should use spring"`) AND the selected element is a `<MotionDemo role="…">`, the AST fast-path can target the `role` prop directly: `ATTR=role`, `NEW_VALUE="<one of: flip|panel|route|soft|spring|scroll|drag|presence>"`. This is faster than a full-file rewrite and keeps the canvas-lib vocabulary intact (the role-→-token mapping in canvas-lib's `MOTION_ROLE_DEFAULTS` already encodes the speed change). If the feedback names a NEW role outside the 8-vocabulary, fall through to the full-file path (the request is structural, not a prop swap).

The token-cost win is the headline result: the orchestrator reads ~5 KB of canvas state (`_active.json` excerpt + one selection record) instead of the full canvas TSX, and writes 0 bytes of file diff outside the targeted attribute byte range. Tracked against the Phase 3.6 budget "< 30 % of pre-phase token cost on a 1-element edit."

### 3. Read active canvas + selected element + open comments

```bash
ACTIVE=$(jq -r .active "$DESIGN_ROOT/_active.json" 2>/dev/null)
[ -z "$ACTIVE" ] || [ "$ACTIVE" = "null" ] && echo "No active canvas. Open a file in browser tab first." && exit 1

SELECTED=$(jq -r '.selected // empty'      "$DESIGN_ROOT/_active.json")
SEL_FILE=$(jq -r '.selected.file // empty' "$DESIGN_ROOT/_active.json")
SEL_VALID=$([[ -n "$SELECTED" && "$SEL_FILE" == "$ACTIVE" ]] && echo 1 || echo 0)

# Open comments — annotations the user dropped on elements via Cmd+Shift+click
# or ⌘C in the dev server UI. `_active.json` mirrors the active file's comments
# inline (server keeps it in sync), so this is a single read.
# (Separate surface: the FigJam draw layer — see skill `whiteboard` for the
# full read/write/template spec. Reach for it when the feedback references the
# user's sketches/stickies/a note pinned to an element, asks to add a
# note/sticky/label to the board, or to answer ON the board — prefer
# `/design:board` over hand-rolling `maude design annotate` calls here.)
OPEN_COMMENTS=$(jq -c '[(.active_comments // [])[] | select(.status != "resolved")]' "$DESIGN_ROOT/_active.json" 2>/dev/null || echo '[]')

# Slug + COMMENTS_FILE for the resolve path. prep.sh (step 1) already computed
# the slug via slug.sh — reuse $ACTIVE_SLUG; fall back to a direct slug.sh call
# only if prep didn't run (e.g. ACTIVE changed after pre-flight).
SLUG="${ACTIVE_SLUG:-$(maude design slug "${ACTIVE#$DESIGN_ROOT/}")}"
COMMENTS_FILE="$DESIGN_ROOT/_comments/$SLUG.json"
```

If `SEL_VALID=1`, the edit is **scoped** to the selected element (selector + dom_path + outerHTML). If not, the edit is **canvas-wide**. Stale selection (`selected.file !== active`) → ignore and flag in the response.

**Open comments take precedence when feedback is empty / generic.** Each entry: `{id, selector, dom_path, tag, classes, bounds, html_excerpt, text, status, created}`. Orchestrator behaviour:

1. **Empty / generic feedback** ("polish", "fix open comments", "")  + open comments exist → iterate over each comment as a separate scoped edit; resolve each after successful edit.
2. **Specific feedback referencing comments** ("address comment 3", "fix all the typography feedback") → match comment ids/text to the request, edit those, resolve them.
3. **Feedback unrelated to comments** → execute feedback first, then warn user that N open comments still need attention.

**To mark a comment resolved (write directly — server picks up on next read / WS broadcast):**
```bash
jq --arg id "$ID" 'map(if .id == $id then .status = "resolved" | .resolved_at = (now | todate) else . end)' \
  "$COMMENTS_FILE" > "$COMMENTS_FILE.tmp" && mv "$COMMENTS_FILE.tmp" "$COMMENTS_FILE"
```

### 3.5 Pre-edit context screenshot — **mandatory when any of**:

- `SEL_VALID=1` (the person has an object selected on this canvas)
- Feedback contains "screenshot" / "udelej si screenshot" / "take a screenshot" (the user asks for one)
- Feedback names a specific UI element by class, role, or component name ("the active item", "search input", "tooltip")
- Feedback compares ≥ 2 surfaces ("X doesn't match Y", "both files", "showcase and resize-panels") — screenshot **each named file**

```bash
OUT="$RUN/shots/context.png"

# Canonical helper — auto-resolves URL from _server.json + _active.json,
# polls for canvas mount, picks engine (agent-browser > playwright fallback).
maude design screenshot --full --out "$OUT"

# If the selected element has a data-dc-element="<id>", grab a focused crop too:
if [ "$SEL_VALID" = "1" ] && [[ "$(jq -r '.selected.selector // empty' "$DESIGN_ROOT/_active.json")" == *"data-dc-element="* ]]; then
  EL_ID=$(jq -r '.selected.selector' "$DESIGN_ROOT/_active.json" | sed -nE 's/.*data-dc-element="([^"]+)".*/\1/p')
  maude design screenshot --element "$EL_ID" --out "$RUN/shots/context-element.png"
fi
```

**Then `Read` the PNG into the conversation** with the Read tool. The selection gives you WHAT (id, selector, markup, bounds); the screenshot gives you WHERE-IN-CONTEXT (neighbors, alignment, the visual conversation the object is part of). Editing from the selection alone is *tapping in the dark*: the bounds tell you where the box is, not what is next to it.

**Multi-surface feedback:** screenshot EACH named file before editing any of them. Compare them visually first, then edit. This is non-negotiable when the user's feedback explicitly names a parity claim ("A is not the same as B").

**Skip ONLY when** none of the four triggers fire, i.e. a canvas-wide cosmetic tweak with no selection and no explicit element reference. In that case, the post-write reality-check screenshot (step 7) is sufficient.

Cost of the screenshot: ~5s + one tool call. Cost of skipping when needed: 2–3 follow-up iterations to undo a bad edit. The rule patches the studio iter-4 incident, where a blind edit shipped a broken selection.

### 3. Name the canvas and make it

**A canvas is made by the app's own create, never by hand.** `POST /_api/canvas` is what ⌘N, Home's "Start with an empty canvas" and the Canvases panel call. It validates the name, picks the folder and the design system, and writes the canvas file and its `.meta.json` together, with the scaffold the UI would have written (an empty `DesignCanvas` with the canvas-lib import). Nothing hand-written: never write the `.tsx` or its `.meta.json` yourself, never copy a template, and never reconstruct what the create writes. A canvas made any other way can differ from the app's in its name, its meta or its scaffold, and the first artboard would not land where the person's own would.

- **`--component`** is the one exception, because a component is not a canvas: write `<DESIGN_ROOT>/<NEW_COMPONENT_DIR>/<PascalName>.tsx` with the Write tool (a new file, so the hooks accept it), reject it if it exists, and skip the rest of this step and of the canvas-only stages (artboard drafting, step 6 and 6b).
- **The name.** Letters, numbers, spaces, `-` and `_`, 60 characters at most, not starting with `_`. A name outside that is refused with the words to show and a folded suggestion (`Přihlášení` → `Prihlaseni`): offer the suggestion, never rewrite the person's name without saying so.
- **A canvas nobody named is named per C4.** "Untitled canvas", then "Untitled canvas 2", "Untitled canvas 3" (the first one not already in the folder; a canvas in the trash does not hold its name). A canvas made from a sentence takes the artifact noun in it, with no AI call: "A poster for my open studio" → "Poster", "A landing page for Studio site" → "Landing page", "Plakát na zápas v sobotu" → "Plakat", and a sentence with no such noun → "Untitled canvas"; the same " 2" counting applies. Leave `name` out and send the sentence as `fromPrompt`, and the create does all of this.
- **The folder.** `group` is a canvas folder the project configures; the default is `NEW_CANVAS_DIR`. The create refuses any other.
- **The design system.** `--ds=<name>` wins (an unknown name was already refused in step 0). Without it a new canvas follows what ⌘N does: the project's default system, and inside a folder whose canvases all use one system, that one. A mixed folder falls back to the default. The create falls back to the default for a name the project does not hold, so a wrong value never makes a canvas that cannot be switched later.

The name, folder and system above are shared with BLANK mode (step 3.5 makes its own brief canvas). The create call below is for normal mode only.

```bash
# Normal mode, after step 2: PORT is the studio's port.
GROUP="$NEW_CANVAS_DIR"
if [ -z "$DS_FLAG" ]; then
  FOLDER_DS=$(for m in "$REPO_ROOT/$DESIGN_ROOT/$GROUP"/*.meta.json; do
                jq -r '.designSystem // empty' "$m" 2>/dev/null; done | sort -u)
  [ "$(printf '%s\n' "$FOLDER_DS" | grep -c .)" -eq 1 ] && TARGET_DS="$FOLDER_DS"   # else keep the default
fi

# A given name goes in as `name`; no name sends the brief as `fromPrompt` and the create names the canvas.
BODY=$(jq -n --arg name "$NAME" --arg prompt "$BRIEF" --arg group "$GROUP" --arg ds "$TARGET_DS" \
  '{kind:"blank", group:$group, designSystem:$ds} + (if $name == "" then {fromPrompt:$prompt} else {name:$name} end)')
CREATED=$(maude design curl-local "http://127.0.0.1:$PORT/_api/canvas" \
  --method POST --header "Content-Type: application/json" --data "$BODY")
jq -e '.ok' <<< "$CREATED" > /dev/null || { jq -r '.error // "the canvas was not created"' <<< "$CREATED"; exit 1; }
TARGET_REL=$(jq -r '.rel'  <<< "$CREATED")     # design-root-relative, e.g. ui/Match Recap.tsx
SLUG=$(jq -r '.slug' <<< "$CREATED")
TARGET_PATH="$REPO_ROOT/$DESIGN_ROOT/$TARGET_REL"
```

The answer is `201 { ok, file, rel, slug }`. On `409` ("a canvas named … already exists", or a name too close to one that does) do not overwrite: take the failure path in [Failure modes](./29-failure-modes.md), ask for a different name or pick a brief-derived one, and create again. Any other refusal carries its sentence in `error`; show it as it is.

**TSX is the only canvas format.** Legacy `.html` canvases have been migrated. The envelope primitives (`DesignCanvas`, `DCSection`, `DCArtboard`, `DCPostIt`) come from `@maude/canvas-lib`, and the created canvas already imports `DesignCanvas` from it; the first artboard brings the other names with it ([Artboards of a kind](../../skills/design/_guide-28-artboards.md)).

The canvas now exists and is empty. From here on every change to it is an **Edit** (the hooks check each write and keep the bytes before it); step 6 says what to write and in which order.

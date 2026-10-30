### 3.5. BLANK mode — make an empty brief canvas (Phase 22)

**Fires only when `BLANK=1` (step 1.6).** Make an empty brief canvas, open it, and **exit** — no UX research, no envelope, no generation, no critic. Zero model cost. A brief canvas is the one New brief makes in the app: a single framed artboard you fill with Sticky notes (`N`), Text (`T`) and Arrows (`A`) describing what each screen should do. When `/design:new` runs again while it is the active canvas, AI reads those annotations as a verbatim brief and drafts the matching artboards right there, below the frame (step 6b).

It is made by the same create as every canvas (step 3). A create that is given a `name` and no `kind` makes the brief canvas (that is what New brief sends); a create with no name makes an empty canvas instead, so BLANK mode always sends a name. Nothing hand-written: no template is copied and no meta is written here.

```bash
# Step 3 gave NAME (may be empty), GROUP and TARGET_DS. No `kind` key: a named create is the brief canvas.
BRIEF_NAME="${NAME:-Brief}"
for N in "" " 2" " 3" " 4" " 5"; do
  BODY=$(jq -n --arg name "$BRIEF_NAME$N" --arg group "$GROUP" --arg ds "$TARGET_DS" \
    '{name:$name, group:$group, designSystem:$ds}')
  CREATED=$(maude design curl-local "http://127.0.0.1:$PORT/_api/canvas" \
    --method POST --header "Content-Type: application/json" --data "$BODY")
  jq -e '.ok' <<< "$CREATED" > /dev/null && break
  [ -n "$NAME" ] && break          # a name the person gave is never renamed behind their back
done
jq -e '.ok' <<< "$CREATED" > /dev/null || { jq -r '.error' <<< "$CREATED"; exit 1; }
TARGET_REL=$(jq -r '.rel' <<< "$CREATED"); SLUG=$(jq -r '.slug' <<< "$CREATED")
TARGET_PATH="$REPO_ROOT/$DESIGN_ROOT/$TARGET_REL"
```

Then:

1. **Seed hint.** A `"<brief>"` passed alongside `--blank` is **not** a generation input: it becomes the faint line under the title on the empty frame (the person's reminder of intent). That is **one Edit** of that line's text in `$TARGET_PATH`, nothing else; with no brief, leave the line as the create wrote it. Plain text only (escape `{`, `}` and `&`).
2. **Do not stamp `brief_sha`.** A brief canvas has no generation brief, and leaving it unset keeps it out of the step-3.6 identical-brief scan. **Do not stamp `annotations_sha`** either: step 6b stamps it on the first ingest, so a never-ingested canvas ingests on its first real run.
3. **Open it.** `maude design open "$TARGET_REL"` shows it in the person's Maude window, so the next `/design:new` with no arguments resolves THIS canvas as the ingest target. The studio owns which canvas is active: never write the active-canvas file yourself. Exit code 3 means no Maude window shows this project; that is fine in a terminal, just say where the canvas is.
4. **Docs:** add an INDEX row (step 11 recipe) — a brief canvas is a real canvas in the Canvases panel.
5. **Print** and exit:

```
✓ Made an empty brief canvas: <DESIGN_ROOT>/<dir>/<Name>.tsx
  Zero model cost; nothing was drafted. It is open in Maude and is now the ingest target.

  Next: annotate it with Sticky (N), Text (T) or Arrow (A) and write what each screen
  should do. Then run /design:new again with no arguments, and the matching artboards
  are drafted right here, below your notes.
```

**Do not continue to step 3.6 / 4 / … — BLANK mode ends here.**

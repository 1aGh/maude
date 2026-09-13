### 3.5. BLANK mode — create an annotation-only brief board (Phase 22)

**Fires only when `BLANK=1` (step 1.6).** Write an empty brief board from `plugins/design/templates/brief-board.tsx.template`, stamp it `kind: "brief-board"`, set it active, and **exit** — no UX research, no envelope, no generation, no critic. Zero model cost.

```bash
# Step 3 gave NAME + TARGET_PATH. Derive the rest the template needs (a brief
# board never reaches frontend-design, so resolve these inline here):
COMPONENT_NAME=$(printf '%s' "$NAME" | sed -E 's/[^A-Za-z0-9]+/ /g' \
  | awk '{for(i=1;i<=NF;i++)$i=toupper(substr($i,1,1)) substr($i,2)}1' | tr -d ' ')
# Guard empty / digit-leading so `export default function <id>()` always parses —
# mirrors canvas-create.ts componentNameFrom (review #2). (ASCII-only here; a
# fully-non-ASCII name degrades to BriefBoard, which is fine for an internal name.)
[[ -z "$COMPONENT_NAME" ]] && COMPONENT_NAME="BriefBoard"
[[ "$COMPONENT_NAME" =~ ^[0-9] ]] && COMPONENT_NAME="Board$COMPONENT_NAME"
SLUG=$(maude design slug "${TARGET_PATH#"$REPO_ROOT"/"$DESIGN_ROOT"/}")
PLATFORM="desktop"; grep -qiE -- '--mobile|mobile|ios|android' <<< "$ARGS $NAME" && PLATFORM="mobile"
# Seed-hint: a "<brief>" passed alongside --blank is NOT a generation input — it
# becomes faint seed text on the empty frame (the user's reminder of intent).
SEED_HINT="${BRIEF:-Empty brief board — annotate me}"
TPL="$CLAUDE_PLUGIN_ROOT/templates/brief-board.tsx.template"
mkdir -p "$(dirname "$TARGET_PATH")"
# Plain {{placeholder}} substitution (the body is fixed; only the header +
# title/seed differ). Escape the seed for sed (it is user text).
SEED_ESC=$(printf '%s' "$SEED_HINT" | sed -e 's/[&/\]/\\&/g')
NAME_ESC=$(printf '%s'  "$NAME"      | sed -e 's/[&/\]/\\&/g')
sed -e "s/{{NAME}}/$NAME_ESC/g" \
    -e "s/{{COMPONENT_NAME}}/$COMPONENT_NAME/g" \
    -e "s/{{DS_NAME}}/$TARGET_DS/g" \
    -e "s/{{PLATFORM}}/${PLATFORM:-desktop}/g" \
    -e "s#{{HISTORY_DIR}}#$DESIGN_ROOT/_history/$SLUG#g" \
    -e "s/{{SEED_HINT}}/$SEED_ESC/g" \
    "$TPL" > "$TARGET_PATH"
```

Then:

1. **Parse-gate** the written file exactly like step 7 (`oxc-parser parseSync`). A brief board is plain JSX, so this should always pass — but never write a board that won't mount.
2. **Stamp `.meta.json`** with `kind: "brief-board"`, `brief: "<NAME>"`, `designSystem: $TARGET_DS`, `platform`, `created` + `last_modified` ISO timestamps, and `subtitle: "brief board"`. **Do NOT stamp `brief_sha`** — a brief board has no generation brief, and leaving it unset keeps it out of the step-3.6 identical-brief scan. **Do NOT stamp `annotations_sha`** yet — it gets stamped on the first ingest (step 6b), so a never-ingested board re-ingests on its first real run.
3. **Set active.** Update `<DESIGN_ROOT>/_active.json` `.active` to the new canvas (so the very next `/design:new` with no args resolves THIS board as the ingest target). Unlike normal mode (which leaves activation to the user clicking the tree), a brief board is created to be immediately annotated, so activating it closes the loop.
4. **Docs:** add an INDEX row (step 11.2/11.3 recipe) — a brief board is a real canvas in the tree.
5. **Print** and exit:

```
✓ Created blank brief board: <DESIGN_ROOT>/<dir>/<Name>.tsx
  Kind: brief-board (kind:"brief-board" in .meta.json — zero model cost, no generation)
  Active: yes (this board is now the ingest target)

  Next: annotate it — pick Sticky (N), Text (T), or Arrow (A) in the canvas chrome
  and write what each screen should do. Then run /design:new again (no args) and
  Claude reads your notes and lays the matching artboards out right here.
```

**Do not continue to step 3.6 / 4 / … — BLANK mode ends here.**

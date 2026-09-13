### 1.5 Cache the DS-context pack (Phase C / DDR-061)

Build (or reuse) the compact DS-context pack — component class names + token names + canvas-lib exports — keyed on `(DS-name, sha-of-the-source-files)`, the **same layer and key scheme** `/design:edit` step 1.5 uses. This lets step 1's "resolve DS context to pass `frontend-design`" AND the B16 inline critic-context (step where `design-critic` / `graphic-design-critic` / `typography-critic` get `tokens_path` + `components_css`) seed from the cached vocabulary instead of each re-`Read`ing `colors_and_type.css` + `_components.css`.

Access the cache via the `maude` CLI (declared dep, on PATH) — `cli/lib` is NOT beside the plugin in a marketplace install (DDR-061).

```bash
COMPONENTS_CSS="$REPO_ROOT/$DESIGN_ROOT/$DS_ROOT/preview/_components.css"
TOKENS_CSS="$REPO_ROOT/$DESIGN_ROOT/$DS_TOKENS"
CANVAS_LIB="$CLAUDE_PLUGIN_ROOT/dev-server/canvas-lib.tsx"
TOKENS_SHA=$(cat "$COMPONENTS_CSS" "$TOKENS_CSS" "$CANVAS_LIB" 2>/dev/null | git hash-object --stdin | cut -c1-12)
DCTX=$(maude cache get design-context "$TARGET_DS/$TOKENS_SHA" 2>/dev/null)
[ -n "$DCTX" ] && echo "→ DS context cache HIT ($TARGET_DS/$TOKENS_SHA)" || echo "→ DS context cache MISS — read the CSS once, then write the pack (see edit.md §1.5 recipe)"
```

On a hit, hand the cached `classNames` / `tokenNames` / `libExports` — plus the DDR-141 brand fields `logoSpecimenPath` / `iconographySpecimenPath` / `assetNames` — to `frontend-design` and the DS-conformance critics directly. On a miss, `Read` the files once, then `printf '%s' "$PACK_JSON" | maude cache put design-context "$TARGET_DS/$TOKENS_SHA"` (identical pack shape to edit.md) so the next `/design:new` or `/design:edit` against this unchanged DS hits. Note the brand fields carry *paths + names* for cheap re-resolution — the logo mark **content** is still Read fresh at step 5a/5b (it must be inlined in the envelope, and the specimen may change without touching the pack's three sha'd sources).

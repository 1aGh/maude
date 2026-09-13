### 3.6. Short-circuit on identical brief (Phase C / DDR-061)

> **Skip in BLANK mode (handled in step 3.5) and INGEST mode (which has its own `annotations_sha` short-circuit in step 6b).** This brief-identity scan is a normal-mode-only guard.

Before the expensive UX research (step 4.5) + generation (step 6), check whether a previous `/design:new` already produced a canvas from a **byte-identical brief in this same DS**. Each canvas's `.meta.json` carries a `brief_sha` (stamped at step 11); scan the canvas dir for a match.

```bash
BRIEF_SHA8=$(printf '%s' "$BRIEF" | shasum -a 256 | cut -c1-8)   # reused by step 4.5's research cache key
EXISTING_MATCH=""; EXISTING_TS=""
while IFS= read -r m; do
  [ -f "$m" ] || continue
  MSHA=$(jq -r '.brief_sha // empty'      "$m" 2>/dev/null)
  MDS=$(jq  -r '.designSystem // "project"' "$m" 2>/dev/null)
  if [ "$MSHA" = "$BRIEF_SHA8" ] && [ "$MDS" = "$TARGET_DS" ]; then
    EXISTING_MATCH="${m%.meta.json}.tsx"
    EXISTING_TS=$(jq -r '.last_modified // .created // "unknown"' "$m" 2>/dev/null)
    break
  fi
done < <(find "$DESIGN_ROOT/$NEW_CANVAS_DIR" -maxdepth 2 -name '*.meta.json' 2>/dev/null)
```

**If `$EXISTING_MATCH` is set:** surface a one-shot AskUserQuestion:

```
Same brief already produced a canvas in this DS:
  <EXISTING_MATCH> (created <EXISTING_TS>)
Pick:
  (a) Open the existing canvas — don't regenerate. (default)
  (b) Re-run anyway — generate a fresh canvas. Step 3's existing-file guard
      forces a distinct name, so the prior file is preserved.
```

On **(a)** → print the existing path, tell the user to click it in the browser file tree to make it active, and **exit without generating**. On **(b)** → continue to step 4 (the new canvas gets a distinct name; the prior is untouched).

**Auto Mode (AskUserQuestion denied):** default to **(b) re-run** — a `/design:new` invocation should produce a canvas (silently producing nothing surprises the user), and the cost is already bounded by the `--quick`/`--no-critic`/budget guards. Stamp `Identical-brief match found (<EXISTING_MATCH>); re-ran per Auto Mode default` in the final print so the collision is visible.

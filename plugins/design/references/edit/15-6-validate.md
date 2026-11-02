### 6. Validate

The hooks check every write (`maude design check --tier fast`): a canvas that no longer parses, draws or keeps its ids is put back at that edit, with the reason. That replaces the old restore-from-snapshot step. What is left for you is the design-level drift the check cannot see:

```bash
grep -q "$(basename "$TOKENS_REL")" "$ACTIVE" || DRIFT=1
# Accept BOTH plain HTML (class="…") and JSX (className="…") form — React canvases
# render the rootClass via JSX so it never appears as a literal HTML attribute.
grep -qE "(^| )(class|className)=\"$ROOT_CLASS([\" ])" "$ACTIVE" || DRIFT=1
# grep for hardcoded #hex in style attributes — should be 0 hits in newly added lines
```

If `DRIFT=1`, fix it with another Edit (put the tokens import or the root class back) and tell the person what drifted. Don't leave a half-themed canvas. The earlier version is in Version history if the person wants to go back.

Nothing here keeps the run alive: the hooks do that while you work.

#### Schema lint on the changed lines (V2-2.15)

Lint only what this edit touched, so legacy debt never blocks an unrelated change:

```bash
maude design ds-check --changed "$ACTIVE:$FROM-$TO" --json --root "$PROJECT_ROOT"   # repeat --changed per edited span / sibling .css
```

The same severities as `/design:new` stage 7: S2 `undefined`/`foreign`, S5 `kit-module`/`other-system`, S9 block; the rest warn. Mechanical fixes (`alias` → v1 name, own-css import removal, wrapper → `ds`) are **offered** to the user and reported when applied (`maude design ds-check --fix=mechanical --canvas "$ACTIVE"`), never silent. `--ds=<name>` on an existing canvas is a **switch**: rewrite `meta.designSystem` (and delete `meta.dsRev`) — the canvas source is not touched; restyling the pinned literals is a separate AI pass.

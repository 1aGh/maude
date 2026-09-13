### WRITE — `kg record-log` (a verdict FILE becomes a node — one line)

A hand-built `kg ingest` envelope is right for a *decision you are composing*. For a **verdict already written to a file** — an RCA, a code/security review, an a11y or visual audit, a critique panel, a keeper report — use the dedicated verb instead:

```bash
maude kg record-log --file ".ai/logs/rca/issue-123.md"                     # kind inferred from the dir
maude kg record-log --file "<designRoot>/_history/<slug>/critique/003-PANEL.md" \
  --kind critic-verdict --about "canvas:<slug>" --link EVALUATES           # design: attach to the canvas
```

Why a verb and not a JSON blob per command:

- **It shares the importer's builder**, so a verdict recorded today is shaped exactly like the ones `maude kg import` migrated — same slug rule, same `{title, path, date}` props, same `ABOUT`/`IN_REPO`/`IN_DEPT` edges, same `EVIDENCE_FOR` edge per cited `DDR-NNN`. Two hand-rolled shapes would fork the corpus and `kg search` would return half an answer.
- **It gates itself** — a silent no-op when the graph is inactive, so a command calls it unconditionally instead of re-deriving the capability check.
- **It never fails the caller.** An ingest error warns; the file is still on disk. Memory must not break real work.
- **It guards slug collisions.** Identity is `hash(kind:name)`, so with `--about` it qualifies the slug with the element name (`settings-001-PANEL`). Without that, two canvases' `001-PANEL.md` collapse into one node and the second **silently overwrites** the first — measured, not theoretical.

**This is what keeps the graph from decaying.** `.ai/logs/**` and `<designRoot>/_history/**` are **gitignored**: for those verdicts the graph is the only inheritable copy. A migration that ingests history but leaves nothing feeding it goes stale from the day it finishes.

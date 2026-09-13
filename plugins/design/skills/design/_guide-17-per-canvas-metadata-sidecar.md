### Per-canvas metadata sidecar

Every canvas project under `<designRoot>/<newCanvasDir>/` has a sibling `<Canvas>.meta.json` (schema: `${CLAUDE_PLUGIN_ROOT}/dev-server/canvas-meta.schema.json`). It captures things that aren't readable from the HTML alone — section/artboard labels, brief, platform, iteration count, tokens used.

**`/design:new`** bootstraps the sidecar from the brief:

```jsonc
{
  "title":    "<Name>",
  "subtitle": "<one-line summary from brief>",
  "brief":    "<full brief>",
  "platform": "desktop|mobile|...",
  "created":  "<ISO>",
  "last_modified": "<ISO>",
  "sections": [
    { "id": "main", "label": "<from brief>", "artboards": [
      { "id": "primary", "label": "<from brief>", "platform": "desktop", "width": 1280, "height": 820 }
    ]}
  ],
  "iteration_count": 0,
  "tokens_used": []
}
```

**`/design:edit`** updates the sidecar after every successful edit:
- `last_modified` ← now
- `iteration_count` ++
- `tokens_used` ← `grep -oE 'var\(--[a-z0-9-]+\)' <canvas> | sort -u`
- If a new `<DCSection>` or `<DCArtboard>` was added/removed/relabeled, sync `sections[]` accordingly. Read the JSX `id` and `title` props.

**Why a sidecar (not embedded in HTML):** the file tree in the dev server browser, the handoff bundle, and `/design:handoff` route mapping all need this metadata without parsing JSX. The sidecar is also human-editable (rename a section by editing one JSON field, no need to touch the canvas).

**Handoff bundle includes the sidecar** at the canvas's path, so consuming agents (production code authors) don't have to parse the canvas just to learn what each artboard is.

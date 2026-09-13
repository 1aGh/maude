### Continuous docs maintenance

The orchestrator calls **`refresh_docs()`** at every exit of the auto-critic loop (see "Auto-critic loop" algorithm above). This is non-skippable — it's the mechanism that keeps `<designRoot>/` self-documenting.

`refresh_docs()` does **incremental** updates by default (only the canvas that changed):

1. **Update `<Canvas>.meta.json` sidecar** (the per-canvas metadata, schema at `dev-server/canvas-meta.schema.json`):
   - `last_modified` ← now (ISO 8601)
   - `iteration_count` ← count of `## Iteration` headers in `_history/<slug>/chat.md`
   - `tokens_used` ← `grep -oE 'var\(--[a-z0-9-]+\)' <canvas> | sort -u`
   - For `/design:new`: also bootstrap `title`, `subtitle` (one-line of brief), `brief` (full), `platform`, `created`, and `sections[]` with `artboards[]` extracted from generated JSX (`DCSection id="..." title="..."` and `DCArtboard id="..." label="..."`).
2. **Update `<designRoot>/INDEX.md`** — find the row for this canvas, replace it; or append if new. Update top-level statistics block (Canvases, Total artboards, Total iterations).
3. **Update `<designRoot>/README.md` "Last updated" line** — the rest of the README is template + extracted hard rules; no need to regenerate unless project metadata changed.

Both files are **committed** (not gitignored) — they're project documentation, not runtime state.

**`/design:setup-docs --full`** triggers full regeneration (rewrite both files from scratch). Used when:
- Project name / config changed
- New `handoffTargets[]` added
- User wants to "snap back" after manual edits

**Auto-marker safeguard.** Both `README.md` and `INDEX.md` carry an HTML comment marker:

```html
<!-- AUTO-MAINTAINED by /design:setup-docs — do not edit by hand. -->
```

Before overwriting, the orchestrator checks the marker. If `<designRoot>/README.md` exists *without* the marker, it's a user-authored README and the refresh refuses (asks user to rename). This protects user content.

**No exit path skips `refresh_docs()`** in `/design:edit` and `/design:new`:

| Exit reason | refresh_docs called? |
|---|---|
| Critic clean (blockers == 0) | ✓ yes |
| Max iterations reached | ✓ yes |
| Divergent (blockers went up) — restored snapshot | ✓ yes |
| Validation failed — restored snapshot | ✓ yes |
| `--no-critic` (loop skipped) | ✓ yes (once, after the single edit) |
| Server / snapshot infrastructure failure | ✗ no (canvas state unknown — manual `/design:setup-docs --full` required) |

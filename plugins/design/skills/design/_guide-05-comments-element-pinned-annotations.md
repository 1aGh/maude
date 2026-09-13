## Comments — element-pinned annotations

The dev-server UI lets the user drop comments on individual elements (Cmd+Shift+click in canvas, or "+ Comment" in status bar after selecting). Comments persist to `<designRoot>/_comments/<slug>.json` (gitignored, runtime state). They are explicit user feedback that Claude must consume.

**Schema per file:**

```jsonc
[
  {
    "id": "c_<6 hex bytes>",
    "file": "<designRoot>/ui/<Canvas>.tsx",
    "selector": "body.<rootClass> > main > section.card:nth-child(3) > h2.title",
    "dom_path": ["body.<rootClass>", "main", "section.card:nth-child(3)", "h2.title"],
    "tag": "h2",
    "classes": "title",
    "bounds": { "x": 80, "y": 248, "w": 320, "h": 32 },
    "html_excerpt": "<h2 class=\"title\">Featured</h2>",
    "text": "Make this 24px instead of 32px and right-align",
    "status": "open" | "resolved",
    "created": "<iso-ts>",
    "resolved_at": "<iso-ts> | null"
  }
]
```

**Endpoints (server):**
- `GET /_comments?file=<urlEncoded>` → `{file, comments}`
- `GET /_comments-all` → `{<file>: [comment...], ...}`
- WebSocket inbound from clients: `{type:"comments-add", payload:{...}}`, `{type:"comments-patch", id, patch:{status:"resolved"|"open", text?}}`, `{type:"comments-delete", id}`, `{type:"comments-request", file}`
- WebSocket outbound (broadcast): `{type:"comments", file, comments}` — sent on every change

**Orchestrator behaviour for `/design:edit "<feedback>"`:**

1. **Always read** `<designRoot>/_comments/<slug>.json` for the active canvas before deciding scope.
2. **Empty / generic feedback** (`""`, `"polish"`, `"fix open comments"`, `"address feedback"`) + open comments exist → iterate over each open comment as a separate scoped edit (use comment.selector + dom_path like a normal selection); resolve each after a successful edit.
3. **Specific feedback referencing comments** (`"comment 3"`, `"the typography ones"`) → match by index/keywords, edit those, resolve them.
4. **Feedback unrelated to comments** → execute feedback first, then warn user that N open comments still need attention. Do NOT silently resolve them.
5. After auto-critic loop completes (or `--no-critic`), open comments that were addressed by the loop should be resolved as part of `refresh_docs()` (orchestrator decides which by inspecting diffs vs. comment selectors).

**To resolve a comment without going through the WS server, write the file directly:**

```bash
COMMENTS_FILE="<designRoot>/_comments/<slug>.json"
jq --arg id "$ID" 'map(if .id == $id then .status = "resolved" | .resolved_at = (now | todate) else . end)' \
  "$COMMENTS_FILE" > "$COMMENTS_FILE.tmp" && mv "$COMMENTS_FILE.tmp" "$COMMENTS_FILE"
```

The next client load (`/_comments-all` fetch or WS reconnect) picks up the new state. Pins in the iframe re-render automatically.

**Comments DO NOT persist across rollback.** `/design:rollback` reverts the canvas HTML, but the comments JSON is independent — open comments stay open after a rollback (they're feedback, not file state).

**Comments do not appear in `_active.json`.** They're keyed by file slug, not by active tab. Multiple files can have open comments simultaneously; the sidebar shows a yellow badge with the open-count next to each file with comments.

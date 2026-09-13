## Active state schema

```jsonc
// <designRoot>/_active.json
{
  "active": "<designRoot>/ui/project/<File>.tsx",
  "open_tabs": ["<designRoot>/ui/project/<File>.tsx"],
  "selected": {
    "file": "<designRoot>/ui/project/<File>.tsx",
    "selector": "body.<rootClass> > div.frame > section.card:nth-child(3) > div.row:nth-child(2)",
    "tag": "div",
    "classes": "row example-row",
    "text": "Row text…",
    "dom_path": ["body.<rootClass>", "div.frame", "section.card:nth-child(3)", "div.row:nth-child(2)"],
    "bounds": { "x": 245, "y": 312, "w": 280, "h": 56 },
    "html": "<div class=\"row example-row\">…</div>",
    "ts": "<iso-ts>"
  },
  "last_change": "<iso-ts>",
  "session_started": "<iso-ts>",
  "active_comments": [ /* mirror of <designRoot>/_comments/<slug>.json for the active file */ ]
}
```

`active` = the tab the user clicked last. `selected` = element the user Cmd+Clicked inside the canvas (cleared automatically when the active tab switches; cleared on Esc inside the iframe; persists otherwise). **`active_comments`** = read-only mirror that the dev server keeps in sync with `<designRoot>/_comments/<slug>.json` for the currently active file — `/design` reads from `_active.json` once and has both selection and comments. Authoritative comment storage remains under `_comments/`; for non-active files, read those files directly.

If `selected.file !== active`, the selection is stale (tab was switched but server didn't yet clear it on its side — race). Treat as canvas-wide.

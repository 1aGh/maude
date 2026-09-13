## Failure modes

| Symptom | Action |
|---|---|
| `_server.json` exists but `kill -0 <pid>` fails | Stale. Delete `_server.json` and start fresh. |
| `_server.json` exists but `curl /_health` fails | Process alive but server hung. Print PID + log path; ask user. Default: kill, restart. |
| Server starts but `/_health` never responds (10s) | Print log path, fail. |
| `_active.json` missing or `active` is null | Print: "No active canvas. Open a file in the browser at <url>, click into it, then retry." |
| `selected.file !== active` (stale selection) | Treat as canvas-wide; mention the staleness once in the response. |
| Selected element's outerHTML appears multiple times in the file | Use dom_path-based context to disambiguate before Edit. |
| Canvas file unreadable | Fail loud with path. |
| Snapshot fails | Refuse to proceed. |
| Edit produces HTML missing tokens link or correct rootClass | Restore from snapshot, report drift. |
| Edit produces HTML with hardcoded colors / non-token fonts | Restore + report. |
| Edit produces JSX inline-style with bare `var(--x)` (unquoted) | Babel parses `var(--x)` as a JS function call; canvas mounts blank. **Lint before write:** `grep -nE "style=\\{\\{[^}]*: var\\(" "$ACTIVE"` should return zero hits. If it doesn't, restore the snapshot and re-issue the edit with quoted CSS strings (`'var(--x)'`) or literal numbers from the radius/size ladder. Retro 2026-05-09 introduced this bug during an opt-out rewrite. |
| `.design/config.json` missing | Use defaults from server `/_config`; warn user once that they're using defaults. |

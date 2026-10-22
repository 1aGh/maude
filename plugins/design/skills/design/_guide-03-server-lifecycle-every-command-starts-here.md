## Server lifecycle — every command starts here

The dev server is the source of truth for "what is the user looking at right now". Canonical recipe is `maude design server-up` (on-PATH `maude` dispatches to the bundled helper — DDR-062) — it checks `_server.json`, verifies PID + `/_health`, respawns if stale, polls 10 s, and prints the port on stdout:

```bash
PORT=$(maude design server-up --root "$REPO_ROOT")
```

Diagnostic goes to stderr (`✓ server alive pid=… port=…` / `→ starting dev server …` / `✗ server start timeout`). The helper passes the user's repo root explicitly — the plugin is installed centrally and serves *any* repo, never assume `__dirname`. **Never start a second instance** by hand; `server-up.sh` is idempotent and the only sanctioned path. Server auto-opens the browser on its own boot (unless `NO_OPEN=1`).

**In the Maude desktop app the server is already there.** Each project open in a tab runs its own bundled `maude-server` (the app keeps up to five running; a tab past that rests and is woken when the person focuses it). It writes `_server.json` like any server, so `server-up` finds and reuses it: ask for the port of the project you are working on (`--root`), never of another tab's. Two projects open at once are two servers on two ports. To move the person's view, use `maude design open` — it reaches the Maude window that shows *this* project and exits 3 when none does.

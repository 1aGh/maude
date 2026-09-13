### 2. Server lifecycle (always first) + runtime-bundle health probe

```bash
PORT=$(maude design server-up --root "$REPO_ROOT")

# Parse-clean ≠ run-clean. A stale server process can cache a broken dynamic
# build of /_canvas-runtime/*.js (the canvas TSX serves fine, but the iframe
# throws at module-eval time). System-review 2026-05-27 D-1. --restart auto-kills
# and respawns; helper exits 3 only when the restarted server is still defective.
maude design runtime-health \
  --port "$PORT" \
  --root "$REPO_ROOT" \
  --restart \
  --quiet \
  || { echo "✗ runtime bundles defective even after restart — abort /design:edit (see stderr)"; exit 1; }
```

`server-up.sh` detects a running server (PID + `curl /_health`), restarts on stale, polls 10 s, stdout = port. Diagnostics on stderr (`✓ server alive pid=… port=…` / `→ starting dev server …`).

`runtime-health.sh` verifies that for every `/_canvas-runtime/<slug>.js` the server returns bytes close to the on-disk pre-built bundle (ratio ≥ 0.5). Lower ratio → defective dynamic Bun.build → auto-restart + a single re-probe; if that doesn't help, `/design:edit` aborts and recommends `lsof -i :$PORT` + manual restart.

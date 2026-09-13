### 2. Server lifecycle check + runtime-bundle health probe

```bash
PORT=$(maude design server-up --root "$REPO_ROOT")

# Parse-clean ≠ run-clean. Probe each /_canvas-runtime/*.js URL the canvas-lib
# pulls in (motion, motion/react, react, react-dom, react/jsx-runtime, …) and
# compare body size to the on-disk pre-built bundle. A stale dev-server process
# can cache a broken dynamic Bun.build (e.g. 409-line motion_react.js with a
# hoisting bug → "ReferenceError: AcceleratedAnimation is not defined" at
# iframe boot). Restart on detected defect.
maude design runtime-health \
  --port "$PORT" \
  --root "$REPO_ROOT" \
  --restart \
  --quiet \
  || { echo "✗ runtime bundles defective even after restart — abort /design:new (see stderr)"; exit 1; }
```

`server-up.sh` detects a running server (PID + `curl /_health`), restarts if stale, polls for 10 s. Stdout = port; diagnostic on stderr.

`runtime-health.sh` HEAD-probes each `/_canvas-runtime/<slug>.js` URL and compares its size to the on-disk pre-built in `<plugin>/dev-server/dist/runtime/`. Ratio < 0.5 = defective dynamic build → `--restart` auto-kill + respawn + a single re-probe; if even the restart fails, the helper exits 3 and `/design:new` aborts (the canvas would mount with a broken runtime). Resolved per system-review 2026-05-27 (D-1): parse-clean is not enough, the runtime bundle must be run-clean before the generation step.

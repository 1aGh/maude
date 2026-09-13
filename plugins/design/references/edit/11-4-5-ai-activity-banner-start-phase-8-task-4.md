### 4.5 AI activity banner — start (Phase 8 Task 4)

Phase 8 ships a yellow "Claude is editing this canvas — your changes may conflict" banner that any browser tab opened on the same canvas sees during this edit. Fire `/_api/ai/start` now so the banner appears before any file mutation, then re-ping `/heartbeat` once between long-running steps (post-validate + post-critic), and `/end` on step 10 (success) or in any error / abort path. The server auto-clears after 30 s of heartbeat silence — covers crashes — but the explicit `/end` ensures the banner clears instantly on normal completion.

```bash
# Phase 8 Task 4 — soft lock banner. Fires before step 5 (apply edit).
curl -s -m 2 -X POST -H 'content-type: application/json' \
  -d "{\"file\":\"$ACTIVE\",\"author\":\"Claude (acting for $(git -C "$REPO_ROOT" config user.name 2>/dev/null || echo 'anonymous')\"}" \
  "http://127.0.0.1:$PORT/_api/ai/start" >/dev/null 2>&1 || true
trap 'curl -s -m 2 -X POST -H "content-type: application/json" -d "{\"file\":\"$ACTIVE\"}" "http://127.0.0.1:$PORT/_api/ai/end" >/dev/null 2>&1 || true' EXIT
```

Treat the curl/trap as best-effort. The banner is decorative; an unreachable dev-server (offline, port mismatch) shouldn't abort an edit.

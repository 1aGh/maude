## Troubleshooting

**"Ref not found: @eN"** — page changed since snapshot. Re-snapshot.



**Element exists but not in snapshot** — off-screen or not yet rendered. `scroll down 1000` then re-snapshot, or `wait --text "..."`.

**Click does nothing** — overlay/modal blocking. Snapshot, find dismiss button, click it, re-snapshot.

**Profile flag ignored** — `⚠ --profile ignored: daemon already running`. Run `agent-browser close --all` first, then your command. Daemon picks up the env profile on fresh start.

**`fill` doesn't work on custom inputs** — use `keyboard inserttext` after `focus`:

```bash
agent-browser focus @e2
agent-browser keyboard inserttext "value"
```

**Cross-origin iframe inaccessible** — silently skipped from snapshot. Use `frame "#iframe-selector"` to scope into it, or `eval` in its origin.

**Daemon stuck / weird state** — `agent-browser close --all && agent-browser doctor`. Use `doctor --fix` only if doctor reports failures.

---

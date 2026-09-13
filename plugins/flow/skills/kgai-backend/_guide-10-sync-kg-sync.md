### SYNC — `kg sync`

```
maude kg sync             # at /flow:done + /flow:pause (push) — deliberate, always attempted
maude kg session-sync     # SessionStart hook (pull) — runs `kg sync --auto` under the hood
```

- **Sync at close only**, never per-edit — the projection rebuild grows with the log. `status`/`resume` read the flat `kg history`/`context` (fast) as the common path.
- Sync failure ⇒ warn, keep local writes (the append-only log is intact), retry next session. **Never block the close.**
- **`--auto` (kgai v1.2.0+) is the engine's own fire-and-forget sync mode** — silent no-op without a store/remote, honors a 60s cooldown, and skips (never blocks) when another sync/write holds the store lock; real attempts land in `<store>/last-autosync.json`. `session-sync` uses it (`kg sync --auto`) because it fires on every SessionStart and must stay cheap; the close-time push (`sync`, no `--auto`) stays a deliberate, uncooled attempt on purpose — a user explicitly ending a session should get a real attempt, not a skipped one. Upstream's OWN Claude Code plugin now fires `kg sync --auto` from both its SessionStart and Stop hooks for the same reason — but that's *their* plugin's hooks, not something a `maude`-integrated repo gets automatically; the bundled desktop kgai plugin (`apps/desktop/.../plugins/kgai/`) deliberately ships with the SessionStart hook stripped (it would run `install.sh`, which needs Go + network — dead weight when the engine is pre-staged as a signed sidecar) and keeps only the Stop hook, which now includes `auto-sync.sh` automatically once the pin is on v1.2.0+.

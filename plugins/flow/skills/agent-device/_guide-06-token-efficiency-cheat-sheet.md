## Token efficiency cheat-sheet

Indicative numbers measured on a home screen, iPhone 16 Pro, iOS 26.1:

| Action                            | Latency | Output     | ~Tokens  |
| --------------------------------- | ------- | ---------- | -------- |
| `open <bundle>` (warm)            | ~4s     | 1 line     | ~10      |
| `snapshot -i` (cold, first run)   | ~27s    | 1.8 KB     | ~470     |
| `snapshot -i` (warm)              | ~1.3s   | 1.8 KB     | ~470     |
| `screenshot` via simctl           | ~0.3s   | 230 KB PNG | 0 (file) |
| `appstate`                        | ~0.5s   | 3 lines    | ~25      |
| `home`                            | ~0.5s   | 1 line     | ~10      |
| `press @eN` / `press 'label="…"'` | ~0.5s   | 1 line     | ~10      |

**Cold start cost**: first snapshot of the day rebuilds the XCTest runner (~30s). Subsequent snapshots in the same daemon session are sub-second. Avoid `agent-device close --all` mid-task — it kills the daemon and the next snapshot pays the cold cost again.

**Rule of thumb**: a 10-step interaction on warm daemon should be <5k tokens. Snapshot is the heavy item — call it only when you actually need refs, prefer `wait text "…"` / `is visible 'label="…"'` / `get text @ref` for read-only checks.

---

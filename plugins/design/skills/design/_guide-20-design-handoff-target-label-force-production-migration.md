### `/design:handoff [--target <label>] [--force]` — production migration

Reads the active canvas. Migrates to one of `handoffTargets` from config. Default target inferred from filename (e.g. `Mobile` → mobile target, `Desktop`/`Studio` → web target) if filename has a hint; otherwise asks the user.

Pre-flight: latest critique should have `blockers == 0`. Override with `--force` only if user explicitly says so.

If `handoffTargets` is empty in config, refuse with: "No handoff targets configured in `.design/config.json`."

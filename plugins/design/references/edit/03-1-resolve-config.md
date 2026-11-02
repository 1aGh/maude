### 1. Resolve config

Invoke skill `design` with input `$ARGUMENTS`. Text you write into Maude for the person (the result, a comment reply) follows skill `contract-voice`.

**One pre-flight call instead of the config jq reads.** `prep.sh --shape edit` reads `.design/config.json` + `_active.json` + `_server.json` in a single pass and exports `DESIGN_ROOT`, `ROOT_CLASS`, `TOKENS_REL`, plus the active-canvas context `ACTIVE_CANVAS`, `SELECTED_FILE`, `SEL_VALID`, `OPEN_TABS`, `ACTIVE_SLUG`, and the server probe `SERVER_UP` / `SERVER_PORT`. Step 2 still runs `server-up.sh` because that helper *starts* a stale/absent server — `prep.sh` only probes.

```bash
eval "$(maude design prep --shell-export --shape edit --root "$REPO_ROOT")"
CFG="$REPO_ROOT/.design/config.json"
```

**The run folder.** The design plugin's hook names it once per conversation, in a line like `Maude run folder for this conversation: .design/_runs/<session>/ (run id r_…)`. Use that folder as `RUN`. No such line (hooks off, or a host without plugin hooks): `RUN=.design/_runs/local/`. Screenshots and critic hand-offs for this edit go under it (`$RUN/shots/`, `$RUN/handoff/`, `$RUN/critique/`). It is runtime state: never versioned, never synced, pruned after a week.

```bash
mkdir -p "$RUN/shots"
```

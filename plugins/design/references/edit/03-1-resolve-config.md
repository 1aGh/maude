### 1. Resolve config

Invoke skill `design` with input `$ARGUMENTS`.

**One pre-flight call instead of the config jq reads + the step-3 slug compute.** `prep.sh --shape edit` reads `.design/config.json` + `_active.json` + `_server.json` in a single pass and exports `DESIGN_ROOT`, `ROOT_CLASS`, `TOKENS_REL`, plus the active-canvas context `ACTIVE_CANVAS`, `SELECTED_FILE`, `SEL_VALID`, `OPEN_TABS`, `ACTIVE_SLUG`, and the server probe `SERVER_UP` / `SERVER_PORT`. Step 3's slug no longer needs a separate `slug.sh` call (use `$ACTIVE_SLUG`); step 2 still runs `server-up.sh` because that helper *starts* a stale/absent server — `prep.sh` only probes.

```bash
eval "$(maude design prep --shell-export --shape edit --root "$REPO_ROOT")"
CFG="$REPO_ROOT/.design/config.json"
```

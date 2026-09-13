## Phase C speed levers — covers manifest, skip, background boot, web-only (DDR-061)

Three levers cut the cost of the slowest daily command. All are **safe-by-default**: a missing `covers.json`, no git, or a disabled `run_in_background` each falls back to today's full synchronous run.

### Covers manifest — `.ai/scenarios/<name>/covers.json`

Each repeatable scenario declares the source globs it exercises, split by platform tier:

```json
{
  "web":    ["app/(video)/**", "components/VideoTape/**"],
  "native": ["expo-app/app/video/**", "expo-app/components/VideoTape/**"],
  "shared": ["packages/api-client/**", "packages/types/**"]
}
```

Entries are **git pathspecs** (a trailing `/**` is treated as the directory). All three tiers contribute to the route-aware skip hash; `web` vs `native`/`shared` membership drives the web-only skip. A scenario with no `covers.json` opts out of both skips (always runs).

### C15 — route-aware skip (fills the orphaned `scenario/` cache layer)

Before running, hash the content of every covered file and key the `scenario/<name>/<covers-sha>` cache on it. If the covered files are unchanged since the last **green** run, reuse the cached report instead of re-running. `--force` bypasses.

```bash
COVERS=".ai/scenarios/$SCENARIO/covers.json"
if [ -f "$COVERS" ] && ! grep -q -- '--force' <<< "$ARGUMENTS"; then
  PATHSPECS=$(jq -r '[.web[]?,.native[]?,.shared[]?] | .[]' "$COVERS" | sed 's#/\*\*$##')
  COVERS_SHA=$( (cd "$REPO" && git ls-files -- $PATHSPECS 2>/dev/null | sort | xargs cat 2>/dev/null) \
                  | git hash-object --stdin | cut -c1-12)
  HIT=$(maude cache get scenario "$SCENARIO/$COVERS_SHA" 2>/dev/null)
  if [ -n "$HIT" ] && [ "$(jq -r '.result' <<< "$HIT")" = "green" ]; then
    echo "Scenario \`$SCENARIO\` last passed green on this exact covered-file set at $(jq -r '.ranAt' <<< "$HIT") — skipping. Use --force to re-run."
    echo "  Report: $(jq -r '.reportPath' <<< "$HIT")"
    exit 0
  fi
fi
```

After a green run, record it (only on green — a failed run must re-run next time):

```bash
printf '{"result":"green","ranAt":"%s","reportPath":"%s","coversSha":"%s"}' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$REPORT_PATH" "$COVERS_SHA" \
  | maude cache put scenario "$SCENARIO/$COVERS_SHA"
```

**Granularity vs `/flow:validate --force`-clean (C13):** C13 skips the *whole* validate only when the entire tree is unchanged. C15 skips *one scenario* when *its* covered files are unchanged — it fires far more often, because most diffs don't touch every scenario's routes.

### C16 — background sim/AVD boot via Monitor

A cold iPad sim or Android AVD boot is 30–60 s and blocks nothing useful. Fire the boots in the background, **Monitor** the booted state, and run the web variants (~20–30 s) while they come up. By the time web finishes, the natives are up — run them with no extra wait.

```bash
# Fire boots in the background — do NOT wait.
xcrun simctl boot "iPad Air 11-inch (M3)" 2>/dev/null   # run_in_background: true
emulator -avd Pixel_7_API_34 -no-window -no-snapshot 2>/dev/null &   # or: agent-device boot --platform android
# Monitor readiness (pushes a line when each is up) while web runs:
#   xcrun simctl bootstatus <udid> -b      → exits 0 when booted
#   adb wait-for-device && adb shell getprop sys.boot_completed
```

Total wall-clock ≈ `max(web, sim-boot + native)` instead of `sim-boot + web + native`. **Fallback:** if `run_in_background` is disabled by the sandbox, fall back to today's synchronous boot in the pre-flight (per the Phase C risk note) — no behavior loss.

### C18 — web-only scope skip (enforced)

When the in-scope diff is **web-only** — every changed file matches a `web` pathspec and **none** match `native` or `shared` — skip native pre-flight entirely: don't boot or detect sims, mark native platforms `skipped: web-only change` in the report (not a fail).

```bash
NATIVE_SPECS=$(jq -r '[.native[]?,.shared[]?] | .[]' "$COVERS" 2>/dev/null | sed 's#/\*\*$##')
CHANGED=$(git -C "$REPO" diff --name-only "$BASE"..HEAD 2>/dev/null)
WEB_ONLY=1
for g in $NATIVE_SPECS; do printf '%s\n' "$CHANGED" | grep -q "^$g" && WEB_ONLY=0; done
# WEB_ONLY=1 → run only web-desktop + web-mobile; skip all simctl/adb calls.
```

## Running an existing scenario

```bash
SCENARIO=flashcards-review-first-3
# 0. Route-aware skip (C15) + web-only scope (C18) — see "Phase C speed levers"
#    above for the full recipes. Run them BEFORE creating the run dir:
#      - covers-unchanged-since-green  → skip, reuse cached report, exit 0
#      - web-only diff                 → run only web variants; skip native pre-flight

RUN_DIR=".ai/device/scenario-runs/$SCENARIO/$(date +%Y-%m-%d-%H%M)"
mkdir -p "$RUN_DIR"/{web-desktop,web-mobile,ios-phone,ios-tablet,android-phone}
echo "RUN_DIR=$RUN_DIR" > /tmp/scenario-run.env

# 1. Background sim/AVD boot (C16) — fire boots with run_in_background, Monitor
#    readiness, and let the web variants below run WHILE the sims come up.
#    (Skip this block entirely when WEB_ONLY=1 from C18.)

# Detect simulator UDIDs / Android serial up-front (fail fast if missing)
IPHONE_UDID=$(xcrun simctl list devices booted -j | python3 -c "import json,sys;d=json.load(sys.stdin)['devices'];print(next((dev['udid'] for k,v in d.items() if 'iOS' in k for dev in v if 'iPhone' in dev['name']), ''))")
IPAD_UDID=$(xcrun simctl list devices booted -j   | python3 -c "import json,sys;d=json.load(sys.stdin)['devices'];print(next((dev['udid'] for k,v in d.items() if 'iOS' in k for dev in v if 'iPad'   in dev['name']), ''))")
ANDROID_SERIAL=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')

# Run all platforms (failure of one does not abort others)
( runners/web-desktop.sh && runners/mobile.sh web-mobile "iPhone 16" ) || true &
WEB_PID=$!
[ -n "$IPHONE_UDID" ]   && runners/ios-phone.sh    "$IPHONE_UDID"    || echo "skipped: no iPhone sim booted" > "$RUN_DIR/ios-phone/result.txt" &
[ -n "$IPAD_UDID" ]     && runners/ios-tablet.sh   "$IPAD_UDID"      || echo "skipped: no iPad sim booted"   > "$RUN_DIR/ios-tablet/result.txt" &
[ -n "$ANDROID_SERIAL" ] && runners/android-phone.sh "$ANDROID_SERIAL" || echo "skipped: no AVD running"      > "$RUN_DIR/android-phone/result.txt" &
wait

# Generate report.md deterministically from result.txt + screenshots in $RUN_DIR
# (Phase C / DDR-061 — the long-standing "report generator" TODO, now shipped).
maude scenario-report "$RUN_DIR"
# Then author ONLY the two <!-- LLM-AUTHORED --> prose sections it leaves.
```

---

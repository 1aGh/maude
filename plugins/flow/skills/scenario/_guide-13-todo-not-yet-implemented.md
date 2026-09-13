## TODO (not yet implemented)

- **Auto-author from prompt** — `/scenario "review first 3 flashcards"` should generate runners. Today: manual.
- ~~**Report generator**~~ — **SHIPPED (Phase C / DDR-061):** `maude scenario-report <run-dir>` walks `<run>/<platform>/result.txt + step-*.png + counters.json` and emits the TL;DR / counter-delta / pivot / path-listing sections of `report.md`; the LLM authors only the two prose sections. Source: `apps/studio/bin/scenario-report.mjs`.
- **iOS-tablet runner** — boot `iPad Air 11-inch (M3)` once, fork `ios-phone` runner with explicit `--udid`. Tab-bar Y likely ~1180 points (re-measure on first run; iPad Air 11" is 820×1180 points).
- **Android-phone runner** — boot AVD (e.g. `Pixel_7_API_34`), use `agent-device --platform android --serial <serial>`. Per the agent-device skill, `find` auto-resolves to nearest hittable ancestor on Android, so coordinate fallbacks should rarely be needed.
- **Per-step `result.txt` schema** — currently only "pass / fail: reason" at platform level. Per-step pass/fail with timing would let the report flag exactly which step diverged.
- **Maestro integration** — `mcp__maestro__*` tools exist; YAML flows might be cleaner than bash for complex scenarios. Worth a spike before scaling.

---

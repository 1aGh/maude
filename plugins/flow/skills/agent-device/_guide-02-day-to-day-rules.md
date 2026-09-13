## Day-to-day rules

### 1. Target device + bundle id (memorise these)

| What                | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| Bundle id           | `<your.bundle.id>` (typically same on iOS + Android)         |
| URL scheme (deep)   | `<your-scheme>://` (OAuth callback, share links)             |
| Default iOS sim     | iPhone 16 Pro (booted)                                       |
| Default Android AVD | `Pixel_7_API_34` (or any `--device` you have provisioned)    |
| Pin a specific sim  | `--udid <UDID>` on iOS (`xcrun simctl list devices booted`)  |
| Pin Android device  | `--serial <serial>` (`adb devices`)                          |

After the first-time setup, the dev client is installed on the booted simulator and **stays logged in** — keychain + AsyncStorage persist across `close` / `open` and across simulator reboots. Do not log out unless the test specifically requires it.

### 1a. Multi-simulator runs (iOS phone + tablet, parallel scenarios)

When you boot more than one iOS sim simultaneously (typical for the `scenario` skill: iPhone 16 Pro + iPad Air 11" together), commands that default to "the booted sim" become non-deterministic. **Always pass `--udid` explicitly** in this mode, and prefer the named-target form for `xcrun simctl`:

```bash
# Detect both UDIDs in one shot
xcrun simctl list devices booted -j | jq -r '.devices | to_entries[].value[] | "\(.name)\t\(.udid)"'
# iPhone 16 Pro    D718C4B7-C011-462E-8047-A2A6BA53CCFA
# iPad Air 11-inch (M3)    7F2A1B3C-...

IPHONE_UDID=D718C4B7-...
IPAD_UDID=7F2A1B3C-...

# iPhone runner uses its UDID for both the daemon AND screenshots
agent-device --platform ios --udid $IPHONE_UDID open <bundle-id>
xcrun simctl io $IPHONE_UDID screenshot /tmp/iphone.png       # NOT `simctl io booted`
agent-device --platform ios --udid $IPHONE_UDID find "<TabLabel>" click

# iPad runner uses the other UDID, can run concurrently in a separate process
agent-device --platform ios --udid $IPAD_UDID  open <bundle-id> &
xcrun simctl io $IPAD_UDID  screenshot /tmp/ipad.png
```

Same rule for Android — when more than one emulator/device is attached, pass `--serial`:

```bash
adb devices                                                   # list serials
agent-device --platform android --serial emulator-5554 open <bundle-id>
```

Each `--udid` (or `--serial`) target gets its own daemon process — they don't fight each other.

### 2. iOS runner xctestrun gotcha (only if Xcode has a custom build location)

If the user's Xcode has `IDECustomBuildLocationType=Absolute` set, Xcode redirects builds to a custom dir (e.g. an external drive) — overriding the `-derivedDataPath` that agent-device passes to `xcodebuild`. The daemon then can't find the freshly-built `.xctestrun` and snapshot fails with `Failed to locate .xctestrun after build` or `Runner build is missing expected products`.

**Detect the situation**:

```bash
defaults read com.apple.dt.Xcode IDECustomBuildLocationType 2>/dev/null
# "Absolute" → quirk applies; anything else / not set → skip this section
defaults read com.apple.dt.Xcode IDECustomBuildProductsPath 2>/dev/null
# prints the custom build root (e.g. an external-drive path), used by $CUSTOM_BUILD_ROOT below
```

**Fix** — symlink the actual build output into where agent-device expects:

```bash
CUSTOM_BUILD_ROOT="$(defaults read com.apple.dt.Xcode IDECustomBuildProductsPath)"
DERIVED="$HOME/.agent-device/ios-runner/derived"
mkdir -p "$DERIVED"
ln -sfn "$CUSTOM_BUILD_ROOT/Debug-iphonesimulator" "$DERIVED/Debug-iphonesimulator"
cp "$CUSTOM_BUILD_ROOT"/AgentDeviceRunner_*.xctestrun "$DERIVED/" 2>/dev/null || true
```

Trigger a build first if no `.xctestrun` exists yet — running any `agent-device snapshot` once will kick off `xcodebuild` (~30-60s on a clean derived dir). Then re-apply the symlink + copy.

The simpler alternative is to reset the Xcode pref to **"Default"** under Xcode → Settings → Locations, but that may affect other projects.

### 3. Screenshot bug — use simctl directly (this Xcode build)

`agent-device screenshot path.png` errors with `xcrun exited with code 1` on iOS 26.x — agent-device misinterprets simctl's "Detected file type from extension" stderr line as failure, even though simctl wrote the PNG. Workaround:

```bash
xcrun simctl io <UDID> screenshot .ai/device/screenshots/foo.png
```

Or grab the booted device automatically (only when **exactly one** sim is booted — `booted` is ambiguous if you've also booted an iPad for parallel scenario runs; in that case use `<UDID>` explicitly per sim):

```bash
xcrun simctl io booted screenshot .ai/device/screenshots/foo.png
```

**Bash-tool sandbox quirk** — on some setups writing simctl screenshots straight into the project root gets `Operation not permitted` (depends on disk volume / TCC permissions). Workaround — write to `/tmp` first, then `mv` into the standard `.ai/device/screenshots/` location:

```bash
xcrun simctl io booted screenshot /tmp/shot.png
mv /tmp/shot.png .ai/device/screenshots/foo.png
```

If the direct write works for you, skip the `/tmp` hop.

(Watch agent-device releases — the `xcrun exited 1` parsing will likely be patched.)

### 4. All artifacts go to `.ai/device/` (gitignored)

```
.ai/device/
├── screenshots/     # PNG screenshots (use simctl)
├── snapshots/       # AX tree dumps, JSON exports
├── traces/          # agent-device trace start/stop output
└── recordings/      # screen recordings (record start/stop)
```

Naming: `<feature>-<step>-<descriptor>.png`. Same convention as agent-browser.

### 5. Compact snapshots, don't sleep

```bash
agent-device snapshot -i             # interactive refs (always use this for actions)
agent-device snapshot                # read-only state (cheaper)
agent-device snapshot -s "Continue"  # scope to label/identifier (faster + cleaner)
agent-device snapshot -i -d 5        # limit tree depth
agent-device snapshot -i --json      # machine parsing — has `rect` per node for fallback coords
agent-device snapshot --diff         # structural delta vs previous baseline
agent-device wait 'label="Home"' 3000        # wait for selector
agent-device wait text "Streak" 3000         # wait for text
# agent-device wait 2000                     # only as last resort
```

### 6. ALWAYS prefer `find` over `press @ref` for known elements

The `find` command resolves a query against a fresh snapshot, then dispatches the action. **It auto-handles ref staleness, finds nearest hittable ancestor (Android), and works even when AX tree is partial.**

```bash
agent-device find "<Label>" click                  # fuzzy: text/label/value/role/id
agent-device find text "Sign In" click             # explicit text locator
agent-device find label "Email" fill "qa@example.com"
agent-device find value "Search" click
agent-device find role button click                # by role
agent-device find id "submit-btn" click            # by testID/id
```

**Selector OR chains** for resilience across platforms / language / refactors — single argument with `||`:

```bash
agent-device click 'id="tab-subjects" || label="Subjects" || text="Subjects"'
agent-device fill  'id="email-input" || label="Email" || placeholder="Email"' "qa@example.com"
```

This is the right pattern for cross-platform .ad scripts. **Use it instead of `press @ref` whenever a stable text/id/label exists** — refs renumber on every snapshot, OR chains do not.

### 7. Coordinate fallback only when AX gap is real

iOS RN apps sometimes hide tab bars / bottom-sheet content from the AX tree (only the active tab is announced). When `find` reports no match for a clearly-visible target:

```bash
agent-device snapshot -i --json | jq '.data.nodes[] | select(.label | tostring | contains("X"))'
# inspect the node's rect, compute center, then:
agent-device press <x> <y>
agent-device snapshot --diff             # verify state changed
```

Coordinates are **points (not pixels)**. Reference table for a typical device set:

| Device                       | Points (W×H) | Tab-bar Y (measure)                                               |
| ---------------------------- | ------------ | ----------------------------------------------------------------- |
| iPhone 16 Pro                | 402 × 874    | ~813                                                              |
| iPad Air 11-inch (M3)        | 820 × 1180   | ~1100–1180 (re-measure on first run; tab bar floats)              |
| Pixel 7 / Pixel 9 (emulator) | 411 × 914 dp | rarely needed — Android `find` auto-resolves to hittable ancestor |

Document why coords were used — ideally file a "missing testID" follow-up so the next run can use a selector.

### 8. Record + replay for repeatable scenarios

`--save-script` records every action while you explore; on `close`, agent-device writes a `.ad` file you can replay deterministically:

```bash
# Author once
agent-device open <bundle-id> --platform ios --session e2e \
  --save-script .ai/scenarios/<name>/ios.ad
agent-device --session e2e snapshot -i
agent-device --session e2e find "<Label>" click
# ... rest of flow ...
agent-device --session e2e close          # writes the .ad

# Replay later
agent-device replay .ai/scenarios/<name>/ios.ad

# Self-heal stale selectors after UI changes
agent-device replay -u .ai/scenarios/<name>/ios.ad
```

> Note: `agent-device test <dir> --retries N --artifacts-dir <path>` is documented in the upstream CLI but **not yet validated in this codebase**. Stick with `replay` until someone runs a multi-script suite end-to-end. If you do try it, file the result back into this skill.

Use `.ad` files as the canonical scenario format — they survive UI churn (with `replay -u`) and run identically on dev + CI.

---

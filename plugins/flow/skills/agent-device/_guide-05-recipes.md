## Recipes

### Quick smoke test of mobile home screen

```bash
agent-device --platform ios open <bundle-id>
agent-device snapshot -i                                # confirm logged in
xcrun simctl io booted screenshot .ai/device/screenshots/smoke-1-home.png
agent-device press 'label="Upload"'                     # tap a known tile
agent-device wait text "<expected modal heading>" 3000
xcrun simctl io booted screenshot .ai/device/screenshots/smoke-2-upload.png
```

### Test deep link (OAuth callback, share link, etc.)

```bash
xcrun simctl openurl booted "<your-scheme>://feed/post/abc123"
agent-device snapshot -i                                # verify routed correctly
```

### Reload Metro after JS change (no rebuild)

```bash
agent-device metro reload                               # in-process JS reload
# or full app relaunch:
agent-device --platform ios open <bundle-id> --relaunch
```

### Capture network during a feature test

```bash
agent-device logs clear --restart
agent-device press 'label="Test"'                       # trigger the buggy interaction
agent-device network dump 50 --include all > .ai/device/snapshots/bug-XYZ-network.txt
```

### Profile RN render perf

```bash
agent-device react-devtools                             # opens RN devtools session
# interact with the slow screen
agent-device perf --json > .ai/device/snapshots/perf-baseline.json
```

See `agent-device help react-devtools` for component-tree inspection, hooks/state reading, render-cause attribution.

### Send a test push notification

If the app's pushes carry a deep-link payload (`data.url`) that the app opens on tap, use a realistic shape so you actually exercise the deep-link router:

```bash
# Notification leading to a feed post
agent-device push <bundle-id> '{
  "aps": {"alert": {"title": "New comment", "body": "Someone replied to your post"}, "sound": "default"},
  "data": {"url": "<your-scheme>://social/post/abc123"}
}'

# Notification leading to a content review screen
agent-device push <bundle-id> '{
  "aps": {"alert": {"title": "Review time", "body": "12 cards waiting"}, "sound": "default"},
  "data": {"url": "<your-scheme>://study/697ccd39d7b8e845fbc165c7/697ccd48d7b8e845fbc165e5"}
}'
```

Tap the notification in the simulator to verify the route handler — common failure mode is the URL scheme being slightly off.

### Android quick start

The same agent-device commands work against Android — pass `--platform android` (and `--serial <emulator-serial>` if more than one device is attached).

```bash
# 1. List available AVDs (one-time)
emulator -list-avds                                          # e.g. Pixel_7_API_34

# 2. Boot it
agent-device boot --platform android --device Pixel_7_API_34
# Or directly: emulator @Pixel_7_API_34 -no-snapshot-load &

adb devices                                                  # verify status: device
ANDROID_SERIAL=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')

# 3. Install the dev build (Expo)
cd <path-to-rn-app>
pnpm dlx expo run:android --device "$ANDROID_SERIAL"         # builds + installs APK + launches

# 4. Drive the app
agent-device --platform android --serial $ANDROID_SERIAL open <bundle-id>
agent-device --platform android --serial $ANDROID_SERIAL snapshot -i | head -10
agent-device --platform android --serial $ANDROID_SERIAL find "<Label>" click
agent-device --platform android --serial $ANDROID_SERIAL fill 'id="email-input" || label="Email"' "qa@example.com"

# 5. Screenshot via adb (parallel to simctl on iOS)
adb -s $ANDROID_SERIAL exec-out screencap -p > .ai/device/screenshots/android-home.png
```

**Android-specific differences from iOS:**

- `find` **auto-resolves to the nearest hittable ancestor** — if a non-clickable `<Text>` matches your selector, agent-device walks up the tree to the closest `Pressable`/`Button`. On iOS you'd have to target the wrapper manually.
- No xctestrun gotcha — Android uses UIAutomator directly, no separate runner build.
- Coordinate fallback rarely needed (the auto-ancestor resolution covers most cases). When you do need it, units are dp (density-independent pixels), not px.
- Push notifications need FCM, not APNs — `agent-device push` shape on Android takes the FCM `data` payload directly without an `aps` wrapper.
- Deep link the dev build: `adb shell am start -W -a android.intent.action.VIEW -d "<your-scheme>://feed/post/abc123"`.

### Record a regression video for a PR

```bash
agent-device record start .ai/device/recordings/PR-1234-flow.mp4
# ... full user flow ...
agent-device record stop
```

---

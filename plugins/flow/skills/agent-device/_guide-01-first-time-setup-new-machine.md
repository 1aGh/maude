## First-time setup (new machine)

Skip this if `agent-device --version` prints `>=0.14.0`, you have a booted iOS simulator with the app's dev client installed, and `agent-device --platform ios open <bundle-id> && agent-device snapshot -i | head -3` shows app content (not an error). Otherwise, run through it once — first cold setup ~5 min, plus a one-time XCUITest build (~30-60s) on the first snapshot.

### 1. Install Xcode + iOS Simulator

You probably already have these for any iOS RN dev work:

```bash
xcode-select -p                                          # should print Xcode path
xcrun simctl list devices available | grep "iPhone 1[5-7] Pro" | head -5
```

If `xcode-select -p` fails, install Xcode from the App Store and run `xcode-select --install`.

### 2. Install agent-device CLI

```bash
npm install -g agent-device                              # or pnpm add -g agent-device
agent-device --version                                   # need >=0.14.0
```

### 3. Boot a simulator + install the mobile dev client

```bash
# Pick any modern iPhone — iPhone 16 Pro is a reasonable default
xcrun simctl boot "iPhone 16 Pro" 2>/dev/null || true
open -a Simulator                                        # opens the simulator window

# Build & install the Expo dev client (if not already on the sim)
cd <path-to-rn-app>
pnpm dlx expo run:ios --device "iPhone 16 Pro"           # builds + installs + launches
# Subsequent JS-only changes hot-reload via Metro — only re-run on native module changes.
```

Verify the dev client landed:

```bash
xcrun simctl listapps booted | grep -A 2 <bundle-id>
```

### 4. First login to the app

The Simulator window opens the app automatically after `expo run:ios`. In that window, log in with whatever credentials you use. Keychain + AsyncStorage persist the session — you won't need to log in again across `close` / `open` or simulator reboots.

### 5. (Maybe) Apply the Xcode build-location workaround

The first `agent-device snapshot -i` triggers a one-time `xcodebuild` of the XCUITest runner (~30-60s). On most setups it just works. **Skip this step unless** that first snapshot fails with `Failed to locate .xctestrun after build` or `Runner build is missing expected products`.

If it does fail, your Xcode has `IDECustomBuildLocationType=Absolute` set (build outputs go outside the default DerivedData). See section "iOS runner xctestrun gotcha" below for the symlink fix.

### 6. Verify

```bash
agent-device --platform ios open <bundle-id>
agent-device snapshot -i | head -10                      # ~30s on first run, ~1.3s after
```

You should see refs and UI text. If you see only `[application] "<App>"` with no children, the app is on the splash/login — log in once via the Simulator window.

---

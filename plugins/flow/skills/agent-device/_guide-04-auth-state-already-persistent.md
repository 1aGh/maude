## Auth state — already persistent

iOS dev client stores session in **keychain + AsyncStorage**. Both survive:

- `agent-device close` + `agent-device open`
- Simulator reboot (`xcrun simctl shutdown booted` + `boot`)
- Most app reinstalls when bundle id stays the same

You don't need `--session-name` or any explicit save command. To verify state, snapshot the home screen and look for a logged-in indicator (greeting / user name).

**To force logout** (e.g. testing onboarding):

```bash
# Path A — through the UI (cleanest)
agent-device --platform ios open <bundle-id>
# navigate to Settings → Logout

# Path B — uninstall + reinstall the app (clears AsyncStorage, but the keychain
# entry survives the uninstall on iOS — you may still land logged in)
xcrun simctl uninstall booted <bundle-id>
# reinstall via `expo run:ios` or by opening the dev-client URL

# Path C — nuclear: erase the entire simulator (wipes keychain too)
xcrun simctl shutdown booted
xcrun simctl erase booted
xcrun simctl boot booted
# rebuild + reinstall the dev client
```

If a "logout" test re-lands logged in, you've hit the iOS keychain-survives-uninstall behavior — go with Path C or Path A.

---

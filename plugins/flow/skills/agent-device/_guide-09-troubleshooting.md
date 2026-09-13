## Troubleshooting

**`Failed to locate .xctestrun after build`** → custom Xcode build location intercepted derivedDataPath. Apply the symlink fix in section "iOS runner xctestrun gotcha".

**`Runner build is missing expected products`** → symlink path is wrong (must be `~/.agent-device/ios-runner/derived/Debug-iphonesimulator`, not `…/Build/Products/Debug-iphonesimulator`). xctestrun expects `__TESTROOT__/Debug-iphonesimulator/`.

**`xcrun exited with code 1` on screenshot** → known agent-device 0.14.x bug. Use `xcrun simctl io booted screenshot path.png` directly.

**Snapshot returns 0 nodes / blank** → app not in foreground. `agent-device appstate` to verify, `agent-device --platform ios open <bundle-id>` to focus.

**`UNSUPPORTED_OPERATION` on keyboard dismiss** → try a visible "Done" / dismiss control via snapshot, or `back --system` only when system nav is acceptable.

**Slow snapshots after a long idle** → daemon may have been killed by the OS. Run any command to respawn (cold start ~30s).

**Refs are stale after a navigation** → `snapshot -i` again. Refs are NOT stable across navigation/modal/list-update.

---

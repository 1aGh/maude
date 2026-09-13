## The core loop

```bash
agent-device --platform ios open <bundle-id>                      # 1. focus app
agent-device snapshot -i                                          # 2. read AX tree (refs in output)
agent-device find "<Label>" click                                 # 3. PREFER find over press @ref
agent-device fill 'label="Email"' "qa@example.com"                # 4. selector for inputs
xcrun simctl io booted screenshot .ai/device/screenshots/X.png    # 5. capture (workaround)
agent-device snapshot --diff                                      # 6. verify mutation
```

**When you DO use refs**: re-snapshot before each `press @ref` — refs renumber on every snapshot, and the same `@e29` after navigation may point to a completely different element.

---

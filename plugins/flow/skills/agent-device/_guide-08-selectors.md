## Selectors

Use selectors instead of refs when stable identifiers exist (testID, accessibility label):

```bash
agent-device press 'id="upload-button"'                  # testID prop in RN
agent-device press 'label="Upload"'                      # accessibilityLabel
agent-device fill 'id="email-field"' "qa@example.com"
agent-device is visible 'label="Online"'
agent-device get text 'id="streak-count"'
```

Prefer `testID` props on important interactive elements — they survive translations and visual changes. If the target lacks testID, file it as a small follow-up.

---

## Platform matrix

| Platform      | Tool          | Bootstrap                                                             | Status       |
| ------------- | ------------- | --------------------------------------------------------------------- | ------------ |
| web-desktop   | agent-browser | default viewport (1280×800)                                           | proven       |
| web-mobile    | agent-browser | `agent-browser set device "iPhone 16"` (393×852, iOS Safari UA)       | proven       |
| ios-phone     | agent-device  | `agent-device --platform ios --udid <iPhone16ProUDID>`                | proven       |
| ios-tablet    | agent-device  | boot iPad sim: `xcrun simctl boot "iPad Air 11-inch (M3)"` + `--udid` | wire next    |
| android-phone | agent-device  | start AVD: `agent-device boot --platform android --device <AVD-name>` | wire next    |

**Default platform set** for a new scenario: **`web-desktop, web-mobile, ios-phone, ios-tablet, android-phone`** (5 platforms). Web-tablet was intentionally dropped — the web app is responsive and uses the same bottom-tab UX at iPad-Pro viewport as at iPhone-16 viewport, so web-mobile already covers tablet web. Add it back only when a tablet-specific layout exists. Platforms not booted are skipped with a `result.txt` reason — do not fail the whole run.

---

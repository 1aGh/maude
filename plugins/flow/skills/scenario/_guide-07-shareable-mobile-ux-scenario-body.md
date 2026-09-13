## Shareable mobile-UX scenario body

When the web app is responsive — at iPhone-16 viewport the same bottom-tab-bar UX appears that the native iOS/Android apps use — the body of any scenario after the tab-bar tap is **shared** across web-mobile, ios-phone, ios-tablet, and android-phone. Only the tab-bar tap differs per platform:

| Platform      | Tab-bar tap                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| web-mobile    | `agent-browser eval 'document.querySelectorAll("button.flex-1")[1].click()'`                                               |
| ios-phone     | `agent-device --platform ios --udid <iphone-udid> press 200 813` (points, fallback)                                        |
| ios-tablet    | `agent-device --platform ios --udid <ipad-udid> press 384 1180` (points, **re-measure on first run**)                      |
| android-phone | `agent-device --platform android --serial <emulator-serial> find "<TabLabel>" click` (auto-resolves to hittable ancestor)  |

When testIDs are added (see follow-ups below), all four become: `find "<TabLabel>" click`.

---

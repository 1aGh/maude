## When NOT to use agent-device

- Web pages (including the web app at localhost:3000 or your production domain) → `agent-browser`
- Anything in Mobile Safari → `agent-browser -p ios`
- DOM eval, cookies, network intercept on web → `agent-browser`
- Pure shell ops (boot/install/uninstall/launch by url) without UI inspection → `xcrun simctl` directly is fine

For everything that touches **a native mobile app's UI**: agent-device, period.

---

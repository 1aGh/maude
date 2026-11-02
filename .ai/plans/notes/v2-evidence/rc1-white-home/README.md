# rc.1 white Home — cause, fix, measurement (2026-11-02)

**Report:** Michal saw a white Home for a long time on the first launch of 2.0.0-rc.1 (`.dmg`). It went away by itself.

**Cause:** `apps/studio/client/index.html` (served by Home and by every project server) loaded Google Fonts with a
parser-inserted `<link rel="stylesheet">`. That holds the first paint until Google answers.
- Chromium probe, real HTML + `styles.css`, an 8 s font delay: **first-paint at 8316 ms**.
- With the font link script-inserted: **100 ms**.
- On top of that, a WKWebView paints white until its page draws. That white shows again across the splash →
  Home origin swap.

**Fix (branch `fix-home-white`, 1b9e98085):**
- The fonts are script-inserted from `app.jsx`. `test/client-index-first-paint.test.ts` pins this: red on the old
  HTML, green now.
- The shell window is the splash's dark ink, and every child webview draws no background of its own.
- `shell.log`: the release shell logs with epoch-ms timestamps.

**Cold start on this Mac** (Michal's real projects, Home only, frames of only the Maude window every 0.5 s, `frames.txt`):

| build | window dark | white frame | Home drawn |
| --- | --- | --- | --- |
| 2.0.0-rc.1 (`/Applications`) | 2.0–4.2 s (shell grey, nothing painted) | **5.1 s: the whole window** | 6.1 s |
| fix (1b9e98085, local release build) | from 0.7 s (splash ink) | **none** | ~3.2–4.1 s |

The font CSS was already cached on this run, so rc.1's white lasted only about 1 s. On a first launch with an empty
cache it lasts as long as the font request does.

`sample` of maude-desktop in the dark seconds: the main thread idles in `mach_msg` (598 of 685 samples). The shell
is not blocked; the wait is WebKit's own start.

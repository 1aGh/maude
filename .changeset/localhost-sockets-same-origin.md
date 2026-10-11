---
"@1agh/maude": patch
---

Security: while Maude runs, other websites can no longer talk to it. The studio's live-collaboration and live-update sockets (`/_ws/collab/<canvas>` and `/_ws`, on both the app and the canvas port) now accept a connection only from the studio itself, as the AI chat socket already did. The file lane that serves your project's files now answers only requests addressed to this machine, so a page using DNS rebinding cannot read files such as `.env` or `.git/config`. Cloud projects are unchanged: their proxy already authenticates every request.

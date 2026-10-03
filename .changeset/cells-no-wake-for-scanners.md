---
"@1agh/maude": patch
---

An idle cloud project is no longer woken by internet scanners. Requests for paths no Maude project serves (`/wp-login.php`, `/.env`, `/.git/…` and similar) now get a 404 from a sleeping cell instead of starting its container. A project that is already running answers exactly as before.

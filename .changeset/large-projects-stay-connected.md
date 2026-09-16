---
"@1agh/maude": patch
---

A project with more than a hundred canvases stays connected.

The desktop opens one connection to the hub for a whole project, and every canvas signs in over it the moment it opens. The hub software we build on closes any connection with more than a hundred canvases signing in at once — so a large project was cut off as it opened, reconnected, signed every canvas in again, and was cut off again, for as long as it stayed open. Nothing synced, and each round used up that designer's sign-in allowance, which then refused their other devices too.

The desktop now spreads a large project across several connections, a few dozen canvases each, so it works with hubs already running. Hubs from this release also accept a project's worth of canvases on a single connection.

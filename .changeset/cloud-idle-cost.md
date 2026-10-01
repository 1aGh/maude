---
'@1agh/maude': patch
---

Idle cloud workspaces and the cloud export service now actually go to sleep. The hourly health check no longer wakes a sleeping project just to read its stats, so a project nobody is using no longer re-downloads its whole design library from storage every hour. The export service now shuts down after ten idle minutes. Before, it ignored the stop signal and ran around the clock.
